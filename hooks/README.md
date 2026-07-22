# Claude Nexus hooks

## nexus-capture

Auto-captures memories from a session. On `Stop`, `PreCompact`, and `SessionEnd`
it spawns the Reflector (detached, non-blocking) which reads new transcript lines,
extracts typed memories via Haiku, dedup-merges them, and writes them to the DB.

## Registration — automatic via the plugin

The hook auto-registers through the **`claude-nexus` plugin** in the local
marketplace. No manual `~/.claude/settings.json` editing is needed.

The plugin declares the hook in:

```
~/.claude/plugins/marketplaces/local/plugins/claude-nexus/hooks/hooks.json
```

which points at this script by absolute path — the same thin-wrapper pattern the
plugin's `.mcp.json` uses for the MCP server. When the `claude-nexus` plugin is
enabled, the `Stop` / `PreCompact` / `SessionEnd` hooks are live in every session.

After changing `hooks.json` (or first enabling the plugin), restart Claude Code
so it reloads the plugin's hooks.

## Prerequisite

Build the runner once — the hook spawns the compiled `dist/capture/runner.js`:

```bash
cd C:\Fran\claude-nexus
npm run build
```

Re-run `npm run build` after pulling capture-pipeline changes.

The Reflector calls Haiku through the Claude Agent SDK, which drives the local
`claude` CLI. That CLI must be authenticated (`claude login`) — separate from the
Claude Code desktop app. A `401` in the runner logs means the CLI needs a fresh login.

## Behaviour

- **Non-blocking** — the hook forwards the payload, spawns a detached runner, exits 0.
  Capture never delays or fails a session.
- **Self-throttling** — a per-session cursor (`sessions.last_reflected_index`) means
  each run only processes transcript lines added since the last run. The Observer gate
  skips the LLM call entirely on trivial windows, so a frequent `Stop` is cheap.
- **Idempotent** — re-running cannot double-write: content-addressed ids plus
  semantic dedup collapse repeats into reconfirmations.

## Usefulness feedback

After `reflect()` runs, the same detached process also runs a retrospective
feedback pass: it reads the session's recall-state file
(`~/.claude/memories/.recall-state/<session_id>.json`, written by
`prompt-runner.ts`), finds any injected-but-not-yet-evaluated memory ids, asks
Haiku for a per-memory usefulness verdict against the full transcript, and
calls `recordFeedback` for each. Evaluated ids are marked in the state file so
a later `Stop`/`PreCompact`/`SessionEnd` firing in the same session doesn't
re-judge them. This is what makes `use_count`/`help_count` — and therefore
`governByHelpRate` — populate automatically, without a manual `nexus_feedback`
call.
