/**
 * Backfill — retroactive memory capture from sessions that predate the hooks.
 *
 * The live hooks only fire on sessions going forward. Every session already on
 * disk needs a one-time pass. Backfill selects un-analyzed sessions and runs
 * the same Reflector over each.
 *
 * There can be thousands of sessions — backfill is therefore SELECTIVE
 * (filters + a limit) and supports a dry run to preview the batch size before
 * spending LLM calls. Idempotent via the per-session reflection cursor.
 */
import Database from 'better-sqlite3';
import { type ReflectDeps } from './reflector.js';
export interface BackfillOptions {
    project?: string;
    minMessages?: number;
    limit?: number;
    since?: string;
    force?: boolean;
    dryRun?: boolean;
}
export interface BackfillResult {
    selected: number;
    processed: number;
    inserted: number;
    merged: number;
    skippedNoSignal: number;
    dryRun: boolean;
}
interface SessionRow {
    session_id: string;
    jsonl_path: string;
    project: string;
    message_count: number;
}
/** Pick the sessions a backfill run would process. */
export declare function selectBackfillSessions(db: Database.Database, opts: BackfillOptions): SessionRow[];
/**
 * Run the Reflector over selected past sessions. With dryRun, only reports how
 * many would be processed. `deps` lets tests inject a fake extractor/embedder.
 */
export declare function backfillSessions(db: Database.Database, opts?: BackfillOptions, deps?: ReflectDeps): Promise<BackfillResult>;
export {};
//# sourceMappingURL=backfill.d.ts.map