/**
 * Claim deduplication cascade (Phase 2, _documents/design-structured-memory.md).
 *
 * Neo4j Agent Memory's three-band cascade, mapped onto dedupe-and-link:
 * above auto-merge -> `duplicates` edge (destructive merge is never done —
 * see the design doc's immutability rule); between flag and auto-merge ->
 * `same_as` pending-review edge; below flag -> a new, distinct claim.
 *
 * Deviation from source-33's Neo4j pattern, stated plainly: Neo4j's combined
 * score is `embedding*0.7 + fuzzy*0.3`, but the design doc explicitly keeps
 * Phase 2 without claim-level embeddings ("Phase 2 keeps memories_vec
 * unchanged... no claim embeddings are generated in Phase 2"). Similarity
 * here is therefore fuzzy-string only. Claim embeddings, and a blended
 * score, are a Phase 3 consideration if the retrieval fork goes claim-level.
 */
import Database from 'better-sqlite3';
import type { MemoryType } from './types.js';
export type DedupBand = 'auto_merge' | 'flag' | 'new';
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