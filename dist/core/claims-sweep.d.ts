/**
 * Claim decomposition sweep — resumable, chunked pass over memories,
 * mirroring src/core/distill.ts's cursor/chunk/backend-failure-abort shape
 * exactly (buildEligibleQuery/countEligible/LLM_FAILURE_ABORT pattern),
 * applied to claims_extracted_at instead of distilled_at.
 *
 * Full-population decomposition is a many-hour job (measured throughput:
 * ~10-30s/call with real backend contention) — this is the core function a
 * driver script (scripts/claim-decompose-sweep.mjs) calls chunk-by-chunk,
 * the same relationship distill-sweep.mjs has to distillMemories().
 */
import Database from 'better-sqlite3';
export interface ClaimsSweepOptions {
    project?: string;
    limit?: number;
    since?: string;
}
export interface ClaimsSweepResult {
    processed: number;
    accepted: number;
    rejected: number;
    claimsWritten: number;
    backendFailed: boolean;
    eligibleRemaining: number;
}
export declare function buildEligibleMemoriesQuery(project: string | undefined, limit: number, since?: string): {
    sql: string;
    params: Record<string, unknown>;
};
export declare function countEligibleMemories(db: Database.Database, project?: string, since?: string): number;
export declare function decomposeMemoriesToClaims(db: Database.Database, opts?: ClaimsSweepOptions, callFn?: (system: string, user: string) => Promise<string>): Promise<ClaimsSweepResult>;
//# sourceMappingURL=claims-sweep.d.ts.map