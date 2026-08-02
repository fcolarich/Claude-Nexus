/**
 * Origin classifier — decides whether a session may write memories at all.
 *
 * Capture noise has three sources. Two are about WHO is running: book/article
 * processing (prose insights that belong in the Knowledge bases, not Nexus) and
 * distill-audit runs (the system generating memories about auditing its own
 * memories, a self-feeding loop). This module owns those. The third — file
 * content read during ordinary work — is a WHAT question, handled by the
 * tool-result scrubber in transcript.ts.
 *
 * Consumed by reflect() for live capture and by scripts/purge-origin.mjs for the
 * retroactive pass, so historical and going-forward rules cannot drift apart.
 */
export interface OriginVerdict {
    excluded: boolean;
    reason: string | null;
}
export interface ExcludeConfig {
    commands: string[];
    scheduled_tasks: string[];
}
export declare function classifyOrigin(transcriptPath: string, cfg: ExcludeConfig, env?: NodeJS.ProcessEnv): OriginVerdict;
//# sourceMappingURL=origin.d.ts.map