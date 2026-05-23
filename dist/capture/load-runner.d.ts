/**
 * nexus-load runner — the SessionStart hook entry point.
 *
 * Reads the SessionStart payload from stdin, recalls budgeted memories for the
 * project, and emits them as `additionalContext`. Synchronous and DB-direct —
 * no Nexus web server required. Must stay fast: it runs on every session start.
 *
 * Registered directly as the hook command (no wrapper): the hook needs the
 * recall output on stdout, so it cannot be a detached spawn.
 *
 * Usage: node dist/capture/load-runner.js   (payload on stdin)
 */
export {};
//# sourceMappingURL=load-runner.d.ts.map