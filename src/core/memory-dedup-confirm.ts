/**
 * Claim-level confirmation gate for memory-level dedup (Phase 2 follow-up,
 * _documents/design-structured-memory.md).
 *
 * consolidateMemories()'s duplicate merge is a single raw cosine-similarity
 * threshold with no confirmation step — no fuzzy blend, no identifier veto,
 * nothing catching the same "boilerplate dominates similarity" failure mode
 * measured on claims (see claim-dedup.ts's identifiersDisjoint docstring).
 * A whole memory is a bigger unit to get wrong than one atomic claim, so an
 * ungated merge there is riskier, not safer.
 *
 * This is NOT a full corpus-wide claim decomposition — decomposition only
 * happens for a memory once it's already a dedup CANDIDATE (cheap embedding
 * pre-filter cleared threshold). Claims persist afterwards regardless of the
 * verdict (claims_extracted_at set either way), so later candidacy against a
 * different memory reuses them for free — cost amortizes across repeated
 * consolidation runs instead of paying upfront for the whole corpus.
 */

import Database from 'better-sqlite3';
import type { MemoryType } from './types.js';
import { extractClaimsForMemory, type ClaimExtractSourceMemory } from '../capture/claim-extract.js';
import { listClaimsForMemory, embedClaim } from './claims.js';
import { detectNumericContradiction } from './claim-contradiction.js';
import { fuzzyStringSimilarity, claimCosineSimilarity, combinedSimilarity } from './claim-dedup.js';
import { extractIdentifiers } from './identifiers.js';
import { generateEmbedding } from './embeddings.js';

/**
 * Deliberately NOT claim-dedup.ts's identifiersDisjoint (any-difference veto):
 * that veto fits 1:1 claim dedup, where a candidate is already known to be
 * similarity-flagged before the veto runs. Here every cross-pair is checked
 * unconditionally as part of a coverage count across many pairs, so a single
 * over-eager veto (e.g. one author writing "nexus_distill sweep cursor",
 * another just "sweep_cursor", for the identical fact) shouldn't kill a
 * match outright — zero-overlap is the more defensible bar when the
 * similarity threshold below is doing real work too.
 */
function identifiersConflict(factA: string, factB: string): boolean {
	const idsA = extractIdentifiers(factA);
	const idsB = extractIdentifiers(factB);
	if (idsA.length === 0 || idsB.length === 0) return false;
	const setB = new Set(idsB);
	return !idsA.some((id) => setB.has(id));
}

export type MemoryDuplicateVerdict = 'confirmed' | 'contradicts' | 'insufficient';

interface ConfirmMemoryInput {
	id: string;
	body: string;
	memory_type: MemoryType;
	confidence: number;
}

// Majority of the smaller memory's claims must find a matching claim in the
// other memory (score >= CLAIM_MATCH_THRESHOLD, no identifier conflict) to confirm.
const CONFIRM_COVERAGE = 0.5;

// Deliberately NOT claim-dedup.ts's classifyDedupBand (0.98/0.92): those bands
// are calibrated for claims extracted from the SAME source text in one pass
// (tight textual overlap by construction). Here, claims come from two
// INDEPENDENTLY authored memories restating the same fact — real duplicates
// measured on the live corpus scored 0.82-0.91 combined (e.g. "no-pagination
// stall...fixed via distilled_at mechanism" vs "...fixed via distilled_at."
// scored 0.899), which never clears 0.92. A live run with the old bands
// found ZERO confirmations out of ~30 real candidate pairs, including
// obvious duplicates — reusing claim-to-claim thresholds for this
// cross-memory context was the bug, not memory-level dedup being sound.
const CLAIM_MATCH_THRESHOLD = 0.78;

async function ensureClaims(
	db: Database.Database,
	memory: ConfirmMemoryInput,
	callFn: (system: string, user: string) => Promise<string>,
): Promise<void> {
	const row = db.prepare(`SELECT claims_extracted_at FROM memories WHERE id = ?`).get(memory.id) as { claims_extracted_at: string | null } | undefined;
	if (row?.claims_extracted_at) return; // already decomposed — reuse persisted claims

	const source: ClaimExtractSourceMemory = { id: memory.id, body: memory.body, memory_type: memory.memory_type, confidence: memory.confidence };
	await extractClaimsForMemory(db, source, callFn);
	db.prepare(`UPDATE memories SET claims_extracted_at = datetime('now') WHERE id = ?`).run(memory.id);
}

async function ensureEmbedded(
	db: Database.Database,
	claimId: string,
	embedFn: (text: string) => Promise<Float32Array | null>,
): Promise<void> {
	const rowid = (db.prepare(`SELECT rowid FROM claims WHERE id = ?`).get(claimId) as { rowid: number }).rowid;
	const hasVec = db.prepare(`SELECT 1 FROM claims_vec WHERE rowid = ?`).get(rowid);
	if (!hasVec) await embedClaim(db, claimId, embedFn);
}

/**
 * Confirm or refute a cheap-embedding-flagged memory duplicate candidate at
 * claim granularity. Lazily decomposes both memories (persisting claims
 * regardless of outcome), then:
 *   1. Any numeric contradiction between a claim in A and a claim in B ->
 *      'contradicts' immediately, no similarity scoring (mirrors
 *      consolidateClaims's own ordering — no score overrides a contradiction).
 *   2. Otherwise, for each of A's claims, look for a same_as/auto_merge-band
 *      match among B's claims that also passes the identifier-conflict veto.
 *      Coverage >= CONFIRM_COVERAGE -> 'confirmed'; else 'insufficient'.
 *   3. Either memory decomposing to zero live claims -> 'insufficient'
 *      (nothing to confirm with; caller should not treat this as a green light).
 */
export async function confirmMemoryDuplicate(
	db: Database.Database,
	memoryA: ConfirmMemoryInput,
	memoryB: ConfirmMemoryInput,
	callFn: (system: string, user: string) => Promise<string>,
	embedFn: (text: string) => Promise<Float32Array | null> = generateEmbedding,
): Promise<MemoryDuplicateVerdict> {
	await ensureClaims(db, memoryA, callFn);
	await ensureClaims(db, memoryB, callFn);

	const claimsA = listClaimsForMemory(db, memoryA.id);
	const claimsB = listClaimsForMemory(db, memoryB.id);
	if (claimsA.length === 0 || claimsB.length === 0) return 'insufficient';

	for (const a of claimsA) {
		for (const b of claimsB) {
			if (detectNumericContradiction(a.fact, b.fact)) return 'contradicts';
		}
	}

	for (const c of [...claimsA, ...claimsB]) await ensureEmbedded(db, c.id, embedFn);

	let matched = 0;
	for (const a of claimsA) {
		const found = claimsB.some((b) => {
			if (identifiersConflict(a.fact, b.fact)) return false;
			const fuzzy = fuzzyStringSimilarity(a.fact, b.fact);
			const embeddingSim = claimCosineSimilarity(db, a.id, b.id);
			return combinedSimilarity(embeddingSim, fuzzy) >= CLAIM_MATCH_THRESHOLD;
		});
		if (found) matched++;
	}

	const coverage = matched / claimsA.length;
	return coverage >= CONFIRM_COVERAGE ? 'confirmed' : 'insufficient';
}
