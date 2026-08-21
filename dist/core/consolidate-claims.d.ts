/**
 * Claim consolidation — dedupe-and-link (Phase 2, _documents/design-structured-memory.md).
 *
 * Mirrors consolidateMemories()'s shape but respects claim immutability:
 * consolidateMemories's "duplicates" band actually calls `supersede.run()`,
 * destructively hiding the loser. Claims may only ADD, LINK, or MARK
 * INVALID — so the equivalent here is markClaimInvalid() (sets
 * valid_until/expired_at, writes a `supersedes` edge), never a silent
 * content merge. `fact` is never rewritten by anything in this file.
 *
 * Order of operations per candidate pair, and why: the numeric-contradiction
 * guard (q-011) runs BEFORE similarity scoring and can VETO it entirely —
 * two claims naming the same subject with different values are routed to
 * `contradicts`, never to `duplicates`/`same_as`, regardless of how high
 * their combined similarity score is. No similarity score may override it.
 *
 * Middle-band (`flag`) adjudication: Neo4j Agent Memory's own pattern treats
 * this band as "pending human review," not an automated LLM confirmation —
 * that is what's implemented here (a `same_as` edge, no LLM call). An LLM
 * bounded-confirmation step (mirroring DDR-005's contradiction-detection
 * pre-filter + confirmation pattern) is a documented follow-up, not built in
 * this pass.
 */
import Database from 'better-sqlite3';
export interface ConsolidateClaimsOptions {
    project?: string;
}
export interface ConsolidateClaimsResult {
    embedded: number;
    processed: number;
    autoMerged: number;
    flagged: number;
    contradictions: number;
}
export declare function consolidateClaims(db: Database.Database, opts?: ConsolidateClaimsOptions, embedFn?: (text: string) => Promise<Float32Array | null>): Promise<ConsolidateClaimsResult>;
//# sourceMappingURL=consolidate-claims.d.ts.map