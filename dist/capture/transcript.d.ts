/**
 * Transcript reader + condenser — the Observer layer of the capture pipeline.
 *
 * Reads a Claude Code session JSONL from a cursor index, strips noise (system
 * reminders, bulky tool output), and condenses it into LLM-ready text for the
 * Reflector. Also reports whether the new window holds any memory-worthy signal,
 * so the Reflector can skip the LLM call on trivial windows.
 */
export interface TranscriptWindow {
    text: string;
    rawLines: string[];
    totalLines: number;
    newLines: number;
    hasSignal: boolean;
    truncated: boolean;
}
/**
 * Read a session JSONL from `fromIndex` to the end and condense it.
 * `fromIndex` is the count of lines already reflected (sessions.last_reflected_index).
 */
export declare function readTranscriptWindow(jsonlPath: string, fromIndex: number): TranscriptWindow;
//# sourceMappingURL=transcript.d.ts.map