/**
 * Numeric contradiction guard (q-011, _documents/design-structured-memory.md).
 *
 * INFERENCE — no prior art in any source consulted for this design. The closest
 * analogs are Graphiti routing high-similarity-but-conflicting pairs to
 * invalidation rather than merge, and a "hard-conflict guard no similarity
 * score can override" referenced in entity-resolution literature. This is a
 * hypothesis requiring its own empirical validation, not an assumed-correct
 * design (see DDR-20260808153555-7a and the design doc's Consolidation
 * Semantics section).
 *
 * Deterministic, code-only, runs BEFORE similarity scoring: two claims about
 * the same subject with different numeric values are a contradiction
 * candidate, never a duplicate, regardless of how close their embeddings are.
 */
import Database from 'better-sqlite3';
export interface NumericContradiction {
    subject: string;
    valueA: string;
    valueB: string;
}
/**
 * Returns the contradiction (subject + both values) if factA and factB name
 * the same subject with different numeric values, else null. Equal values
 * are NOT a contradiction — that is a duplicate, which the dedup cascade
 * handles separately.
 */
export declare function detectNumericContradiction(factA: string, factB: string): NumericContradiction | null;
/**
 * Write a bidirectional `contradicts` pair (a->b and b->a) between two claims,
 * per DDR-005's bidirectionality rule (symmetric lookups from either endpoint).
 * Surfacing-only: never deletes, hides, or supersedes either claim — a human
 * or a later claim resolves it. Idempotent (INSERT OR IGNORE on the same
 * UNIQUE(source_id, target_id, link_type) memory_links already enforces).
 */
export declare function writeContradictionLinks(db: Database.Database, claimIdA: string, claimIdB: string): void;
//# sourceMappingURL=claim-contradiction.d.ts.map