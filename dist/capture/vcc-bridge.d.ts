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
//# sourceMappingURL=vcc-bridge.d.ts.map