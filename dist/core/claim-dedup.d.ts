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
export declare function identifiersDisjoint(factA: string, factB: string): boolean;
export declare function classifyDedupBand(similarity: number, thresholds?: {
    autoMerge?: number;
    flag?: number;
}): DedupBand;
/**
 * Sørensen–Dice coefficient over character bigrams. Deterministic, no
 * external dependency, no model call — the only similarity signal available
 * for claim dedup in Phase 2 (no claim embeddings exist yet).
 */
export declare function fuzzyStringSimilarity(a: string, b: string): number;
/**
 * Blend an embedding-cosine score with a fuzzy-string score per Neo4j Agent
 * Memory's pattern (source-33). When no embedding score is available (claim
 * not yet embedded, or the embedding backend is down), falls back to
 * fuzzy-only rather than blocking dedup on an unrelated capability.
 */
export declare function combinedSimilarity(embeddingSim: number | null, fuzzySim: number): number;
/** Read a claim's stored embedding straight from claims_vec by rowid. Null on any miss. */
export declare function loadStoredClaimVector(db: Database.Database, rowid: number): Float32Array | null;
/** Cosine similarity between two claims' stored (unit-normalized) vectors, or null if either is missing. */
export declare function claimCosineSimilarity(db: Database.Database, claimIdA: string, claimIdB: string): number | null;
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
export declare function findDedupCandidates(db: Database.Database, claim: DedupQueryClaim): DedupCandidate[];
//# sourceMappingURL=claim-dedup.d.ts.map