# Design: VCC follow-ups for claude-nexus

Source: `C:\Fran\LLM_Workflow_Optimization\.claude\worktrees\upbeat-greider-cef37a\vcc-claude-nexus-prompt.md`, ADR-20260808153133-b0, FEAT-20260808153256-cd, FEAT-20260808153304-6d.

## Problem

VCC (`vcc_compact`) currently only does pre-extraction transcript conditioning inside `reflect()`. Two gaps identified in the source ADR:

1. A memory's `source_session_id` links back to its originating session, but the session's raw transcript path is never surfaced via MCP — an agent that gets a memory hit has no way to go read the original conversation.
2. There is no periodic whole-transcript compaction happening anywhere. The one attempt at this (`compactFileInPlace`, in-place overwrite) was disabled 2026-07-24 (this repo's ADR-015) after it destroyed two live transcripts with lossy rendering. Nothing has replaced it since.

## Goals

- `nexus_sessions` output includes each session's transcript path, with zero new DB reads (the data is already selected).
- A new `compactToParallelFile` primitive produces a periodic shrunk copy of a session's transcript to a **sibling file**, wired opportunistically into the existing `reflect()` call path.
- The new primitive is structurally incapable of ever writing over the original transcript — even under simulated CLI failure — proven by a regression test, not just review.

## Non-goals

- Re-enabling or modifying the disabled `compactFileInPlace` call site (`reflector.ts:274-288`) — left untouched.
- `nexus_search_session` (session-scoped raw-content FTS) — FEAT-20260808153312-b0, explicitly deferred.
- Post-archive optimization pass — FEAT-20260808153323-e6, explicitly deferred (unconfirmed external bridging contract).
- No new timer/daemon/long-lived process — trigger stays inside the existing per-invocation `reflect()` call.

## Constraints

- Scope ceiling: `src/mcp/server.ts`, `src/capture/vcc-bridge.ts`, `src/capture/reflector.ts`, `src/core/database.ts` (migration only) + their co-located `*.test.ts` files. Nothing else without asking first.
- Tech stack locked: better-sqlite3 numbered-migration pattern (`database.ts:61-62`), vitest, this repo's existing fail-open error-handling convention (log + leave column untouched on failure, mirroring `vcc_shrunk_at`).
- Safety constraint (hard): `compactToParallelFile` must never be able to target the original `jsonlPath` for a rename/write, under any code path, including a forced/simulated CLI failure. This is the direct lesson from ADR-015 and is non-negotiable.

## Proposed Approach

**Item 1 — expose transcript_path (chosen: extend existing tool's output).**
`listSessions()` already does `SELECT *`, so `Session` rows already carry `jsonl_path`. `mcp/server.ts:248-256`'s formatter just doesn't print it. Add `transcript_path: s.jsonl_path` to the emitted line per session.

- Alternative considered: new `nexus_get_session(session_id)` lookup tool. Rejected — strictly more surface area (new tool, new schema, new test file) for data that's already in hand; the source prompt explicitly left this as "your call."

**Item 2 — parallel-file auto-compact (chosen: new function, reusing `compactFileInPlace`'s CLI-invocation internals, diverging only at the final rename target).**

- `compactToParallelFile(jsonlPath, opts)` in `vcc-bridge.ts`: same `runCli`/temp-file flow as `compactFileInPlace` (`vcc-bridge.ts:138-163`), but the temp output is renamed to `${jsonlPath}.vcc-shrunk.jsonl` — never to `jsonlPath`. Returns `CompactResult & { path?: string }` (`path` present iff `ok`).
- Migration v12 (`vcc-shrunk-path`): `ALTER TABLE sessions ADD COLUMN vcc_shrunk_path TEXT`, following the exact try/catch idempotent shape of `migrateVccShrunkAt` (v10) / `migrateDistillCursor` (v11).
- Wiring in `reflector.ts`: after the existing candidate-processing block (near the disabled block at line 274, but as new code — the disabled block itself is untouched), check whether the current unprocessed window exceeds a **byte-size threshold**: `Buffer.byteLength(window.rawLines.join('\n'), 'utf-8') > 200_000` (~200KB). If exceeded, call `compactToParallelFile(opts.transcript_path, { timeoutMs: 15_000 })`. On success, `UPDATE sessions SET vcc_shrunk_path = ? WHERE session_id = ?`. On failure, `console.error` and leave the column untouched — fail-open, no throw, matching the existing `vcc_shrunk_at` failure handling.
- Alternative considered: line-count threshold (500 lines). Rejected in favor of byte-size — ties the trigger more directly to what the CLI subprocess actually has to process, independent of how verbose individual JSONL lines are (a session with a few huge tool-result lines would never trip a line-count gate).
- Alternative considered (rejected): trigger via a new background timer/daemon. Rejected — this repo explicitly has no long-lived per-session process; the source prompt calls this out directly.

## Key Questions for the architect

- Exact insertion point in `reflector.ts` for the threshold check + `compactToParallelFile` call — must not interfere with `advanceCursor`, the redaction-logging block, or the disabled block's comments/ordering.
- Whether `compactToParallelFile`'s regression test should mock `runCli`/`spawnSync` directly, or force failure via an unwritable/invalid path — architect/planner to pick whichever gives the strongest "never targets jsonlPath" guarantee with least mocking complexity.
- Confirm `CompactResult`'s shape extension (`path?: string`) doesn't require touching any other `vcc-bridge.ts` call site (`compactWindowLines` return type is untouched; `reflector.ts`'s pre-extraction call site destructures `.ok`/`.text` only, so an additive field is safe) — architect to verify no other consumer does exhaustive destructuring that would break.

## Success Criteria

- `nexus_sessions` tool output includes `transcript_path` for every listed session; `mcp/server.test.ts` asserts this.
- `compactToParallelFile`: unit tests cover (a) success path writes `${jsonlPath}.vcc-shrunk.jsonl` and returns `{ ok: true, path }`, original file untouched; (b) CLI failure path — original file byte-identical to before, `renameSync` never invoked with `jsonlPath` as a target, no `.vcc-shrunk.jsonl` file left behind.
- `database.test.ts`: migration v12 adds `sessions.vcc_shrunk_path` (nullable, default NULL), mirroring the existing v10 test.
- `reflector.test.ts`: (a) window byte-size over threshold triggers `compactToParallelFile` and sets `vcc_shrunk_path`; (b) under threshold, no vcc call, column untouched; (c) CLI failure inside the trigger leaves `vcc_shrunk_path` NULL and does not throw or abort `reflect()`.
- `npm test` (vitest) passes with no regressions to existing suites, notably `reflector.test.ts`'s existing `vcc_shrunk_at`-focused tests (untouched disabled block).
