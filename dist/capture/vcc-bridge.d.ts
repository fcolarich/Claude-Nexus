export interface CompactOptions {
    keep?: number;
    timeoutMs?: number;
    pythonBin?: string;
}
export interface CompactResult {
    ok: boolean;
    text?: string;
    preTokens?: number;
    postTokens?: number;
    error?: string;
}
/** Suffix used for the sibling shrunk-file written by compactToParallelFile. */
export declare const VCC_SHRUNK_SUFFIX = ".vcc-shrunk.jsonl";
export type ParallelCompactResult = CompactResult & {
    path?: string;
};
/** Compacts a raw JSONL window (array of raw line strings, not yet joined) via a
 * throwaway temp input file. Used by the pre-extraction call site — the window is
 * a slice of the transcript, not the whole file, so it cannot be run through the
 * CLI in place. */
export declare function compactWindowLines(rawLines: string[], opts?: CompactOptions): CompactResult;
/** Compacts a whole JSONL file in place: runs the CLI with --out to a sibling temp
 * file, then atomically renames the temp file over jsonlPath on success. Leaves
 * jsonlPath untouched on any failure. Used by the post-extraction shrink and by
 * the cold-session backfill's TS-callable counterpart (none needed — backfill is
 * pure Python, see ColdSessionBackfill). */
export declare function compactFileInPlace(jsonlPath: string, opts?: CompactOptions): CompactResult;
/** Returns the sibling shrunk-file path for jsonlPath. Pure — no I/O. */
export declare function parallelShrunkPath(jsonlPath: string): string;
/** Compacts a whole JSONL file to a sibling `.vcc-shrunk.jsonl` file, never touching
 * jsonlPath itself. Reuses compactFileInPlace's runCli/temp-file flow, but renames
 * the temp output to parallelShrunkPath(jsonlPath) instead of over jsonlPath. There
 * is deliberately no destination parameter — the sibling path is always derived. */
export declare function compactToParallelFile(jsonlPath: string, opts?: {
    timeoutMs?: number;
}): ParallelCompactResult;
//# sourceMappingURL=vcc-bridge.d.ts.map