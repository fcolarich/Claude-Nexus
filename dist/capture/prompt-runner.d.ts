/**
 * nexus prompt-runner — the UserPromptSubmit hook entry point.
 *
 * Reads the UserPromptSubmit payload from stdin, embeds the user's prompt,
 * recalls the few most-relevant memories (vector similarity above a floor),
 * dedups against memories already injected this session, and emits them as
 * `additionalContext`. Best-effort: any failure exits 0 with no output and
 * never blocks the prompt.
 *
 * Usage: node dist/capture/prompt-runner.js   (payload on stdin)
 */
/**
 * Loads the per-session recall-state file as a Map<memoryId, evaluated>.
 * Transparently migrates the legacy flat string[] format (pre-feedback-judge)
 * to {id, evaluated:false} entries. Missing/corrupt files return an empty map
 * — best-effort, matches the rest of this hook's failure handling.
 */
export declare function loadInjected(sessionId: string, stateDir?: string): Map<string, boolean>;
export declare function saveInjected(sessionId: string, ids: Map<string, boolean>, stateDir?: string): void;
//# sourceMappingURL=prompt-runner.d.ts.map