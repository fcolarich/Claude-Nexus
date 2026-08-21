/**
 * Claim deduplication cascade (Phase 2, _documents/design-structured-memory.md).
 *
 * Neo4j Agent Memory's three-band cascade, mapped onto dedupe-and-link:
 * above auto-merge -> `duplicates` edge (destructive merge is never done —
 * see the design doc's immutability rule); between flag and auto-merge ->
 * `same_as` pending-review edge; below flag -> a new, distinct claim.
 *
 * Claim embeddings (claims_vec, migration v14) are scoped EXCLUSIVELY to this
 * dedup cascade — never queried by recall.ts/nexus_search. "Memory stays the
 * unit of retrieval through Phase 2" (design doc) constrains the query-return
 * interface, not internal consolidation-time signals, so blending an
 * embedding score into dedup does not pre-decide the Phase 3 claim-vs-memory
 * retrieval fork. combinedSimilarity() implements Neo4j Agent Memory's blend
 * (source-33): `embedding*0.7 + fuzzy*0.3`, falling back to fuzzy-only when
 * no embedding is available (e.g. embedding backend down — fails open rather
 * than blocking dedup).
 */

import Database from 'better-sqlite3';
import type { MemoryType } from './types.js';
import { extractIdentifiers } from './identifiers.js';

export type DedupBand = 'auto_merge' | 'flag' | 'new';

/**
 * Identifier-conflict veto. Found by running consolidateClaims against the
 * live corpus: short, template-like claims sharing nearly all sentence
 * structure but naming a different symbol/file/entity ("doc-sync regenerates
 * notes.md" vs "doc-sync regenerates design.md") scored high on
 * combinedSimilarity because the shared boilerplate dominates both fuzzy and
 * embedding similarity — the identifiers that actually distinguish them are
 * a small fraction of the text. Mirrors detectNumericContradiction's veto
 * shape (runs before similarity, no score can override it), but for named
 * entities instead of numeric values.
 *
 * Vetoes on ANY set difference, not just zero overlap — measured on the live
 * corpus's 39 flagged pairs: zero-overlap only caught 2/39 (most real false
 * positives share SOME identifiers, e.g. two facts both naming
 * ImpactCollisionSystem but differing in which method they synchronize via),
 * while any-difference caught 11/39 (9 real false positives, 2 false
 * negatives — a stray extra identifier from unrelated wording, and a pure
 * case-sensitivity difference). Accepted trade-off: a missed duplicate is
 * silent and harmless (same_as is a non-destructive review hint), a wrong
 * same_as edge actively asserts two different facts are the same thing.
 *
 * Only vetoes when BOTH facts carry identifiers — if either has none there's
 * nothing to disagree on, so this falls through to normal similarity scoring.
 */
export function identifiersDisjoint(factA: string, factB: string): boolean {
	const idsA = extractIdentifiers(factA);
	const idsB = extractIdentifiers(factB);
	if (idsA.length === 0 || idsB.length === 0) return false;
	if (idsA.length !== idsB.length) return true;
	const setB = new Set(idsB);
	return !idsA.every((id) => setB.has(id));
}

// Starting thresholds per source-33 (Neo4j Agent Memory): "start at 0.98/0.92
// and relax only after validating quality." Calibration on the real corpus
// is required before these can be trusted as tuned rather than a starting point.
const DEFAULT_AUTO_MERGE_THRESHOLD = 0.98;
const DEFAULT_FLAG_THRESHOLD = 0.92;

export function classifyDedupBand(
	similarity: number,
	thresholds?: { autoMerge?: number; flag?: number },
): DedupBand {
	const autoMerge = thresholds?.autoMerge ?? DEFAULT_AUTO_MERGE_THRESHOLD;
	const flag = thresholds?.flag ?? DEFAULT_FLAG_THRESHOLD;
	if (similarity >= autoMerge) return 'auto_merge';
	if (similarity >= flag) return 'flag';
	return 'new';
}

function bigrams(s: string): Set<string> {
	const out = new Set<string>();
	for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
	return out;
}

/**
 * Sørensen–Dice coefficient over character bigrams. Deterministic, no
 * external dependency, no model call — the only similarity signal available
 * for claim dedup in Phase 2 (no claim embeddings exist yet).
 */
export function fuzzyStringSimilarity(a: string, b: string): number {
	const na = a.trim().toLowerCase().replace(/\s+/g, ' ');
	const nb = b.trim().toLowerCase().replace(/\s+/g, ' ');
	if (na === nb) return 1.0;
	if (na.length < 2 || nb.length < 2) return 0;

	const setA = bigrams(na);
	const setB = bigrams(nb);
	let intersection = 0;
	for (const bg of Array.from(setA)) if (setB.has(bg)) intersection++;
	return (2 * intersection) / (setA.size + setB.size);
}

const EMBEDDING_WEIGHT = 0.7;
const FUZZY_WEIGHT = 0.3;

/**
 * Blend an embedding-cosine score with a fuzzy-string score per Neo4j Agent
 * Memory's pattern (source-33). When no embedding score is available (claim
 * not yet embedded, or the embedding backend is down), falls back to
 * fuzzy-only rather than blocking dedup on an unrelated capability.
 */
export function combinedSimilarity(embeddingSim: number | null, fuzzySim: number): number {
	if (embeddingSim === null) return fuzzySim;
	return embeddingSim * EMBEDDING_WEIGHT + fuzzySim * FUZZY_WEIGHT;
}

/** Read a claim's stored embedding straight from claims_vec by rowid. Null on any miss. */
export function loadStoredClaimVector(db: Database.Database, rowid: number): Float32Array | null {
	let row: { embedding: Buffer } | undefined;
	try {
		row = db.prepare(`SELECT embedding FROM claims_vec WHERE rowid = ?`).get(rowid) as { embedding: Buffer } | undefined;
	} catch {
		return null; // claims_vec absent (sqlite-vec not loaded)
	}
	if (!row?.embedding) return null;
	return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

/** Cosine similarity between two claims' stored (unit-normalized) vectors, or null if either is missing. */
export function claimCosineSimilarity(db: Database.Database, claimIdA: string, claimIdB: string): number | null {
	const rowidOf = (id: string) => (db.prepare(`SELECT rowid FROM claims WHERE id = ?`).get(id) as { rowid: number } | undefined)?.rowid;
	const rowidA = rowidOf(claimIdA);
	const rowidB = rowidOf(claimIdB);
	if (rowidA === undefined || rowidB === undefined) return null;

	const vecA = loadStoredClaimVector(db, rowidA);
	const vecB = loadStoredClaimVector(db, rowidB);
	if (!vecA || !vecB || vecA.length !== vecB.length) return null;

	let dot = 0;
	for (let i = 0; i < vecA.length; i++) dot += vecA[i] * vecB[i];
	return dot;
}

export interface DedupQueryClaim {
	id: string;
	memory_id: string;
	claim_type: MemoryType;
	fact: string;
}

export interface DedupCandidate {
	id: string;
	memory_id: string;
	claim_type: MemoryType;
	fact: string;
	identifiers: string[];
}

/**
 * Type-constrained candidate retrieval: same claim_type, same project/scope
 * as the query claim's parent memory, excludes the claim itself and any
 * already-invalidated claim. Mirrors distill.ts's relatedMemories() scoping
 * (same principle, applied at claim granularity). No embedding search here —
 * this is the SQL prefilter; ranking against candidates is the caller's job
 * via fuzzyStringSimilarity + classifyDedupBand.
 */
export function findDedupCandidates(db: Database.Database, claim: DedupQueryClaim): DedupCandidate[] {
	const rows = db.prepare(`
		SELECT c.id, c.memory_id, c.claim_type, c.fact, c.identifiers
		FROM claims c
		JOIN memories m ON m.id = c.memory_id
		JOIN memories qm ON qm.id = @queryMemoryId
		WHERE c.claim_type = @claimType
		  AND c.valid_until IS NULL
		  AND c.id != @excludeId
		  AND m.project IS qm.project
		  AND m.scope = qm.scope
	`).all({
		queryMemoryId: claim.memory_id,
		claimType: claim.claim_type,
		excludeId: claim.id,
	}) as Record<string, unknown>[];

	return rows.map((r) => ({
		...(r as unknown as DedupCandidate),
		identifiers: JSON.parse((r.identifiers as string) || '[]'),
	}));
}
