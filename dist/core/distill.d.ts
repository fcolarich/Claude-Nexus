/**
 * Distill — LLM-driven cleanup of EXISTING memories.
 *
 * Where consolidation merges near-identical duplicates structurally, distill
 * goes further: it clusters *related* memories (medium similarity) and rewrites
 * each cluster into one tighter, non-redundant memory, then sanitizes verbose
 * singletons. Use it to clean up legacy / hand-written memories.
 *
 * The rewrite is mechanical (compress these given texts) rather than judgment —
 * a local model is a reasonable choice here. Uses the configured extraction
 * model via callModel().
 */
import Database from 'better-sqlite3';
export interface DistillResult {
    embedded: number;
    clusters: number;
    merged: number;
    created: number;
    sanitized: number;
}
export declare function distillMemories(db: Database.Database, embedFn?: (text: string) => Promise<Float32Array | null>, callFn?: (system: string, user: string) => Promise<string>): Promise<DistillResult>;
//# sourceMappingURL=distill.d.ts.map