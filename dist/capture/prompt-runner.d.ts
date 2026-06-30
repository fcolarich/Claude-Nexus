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
export {};
//# sourceMappingURL=prompt-runner.d.ts.map