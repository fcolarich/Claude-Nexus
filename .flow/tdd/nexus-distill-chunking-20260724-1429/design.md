# Design: Bound nexus_distill to handle large memory sets

## Problem

`nexus_distill` (`src/core/distill.ts` → `distillMemories()`, exposed via `mcp__plugin_claude-nexus_claude-nexus__nexus_distill` in `src/mcp/server.ts`) processes the entire live memory table in one unbounded run with no scope or size parameter. On the production DB (12,078 memories across 40+ projects) it hung indefinitely instead of failing fast or reporting incremental progress, requiring a manual process kill.

Root cause (confirmed by reading `distill.ts`):
1. The main clustering loop iterates every non-superseded, non-rejected memory (`all`, unbounded `SELECT * FROM memories ...`).
2. For **every** memory in that loop it calls `embedFn(m.body)` — i.e. a fresh Ollama embedding call — even though the memory is already embedded in `memories_vec` (the `embedUnindexedMemories` backfill at the top only handles memories with *no* embedding at all, not reuse of existing ones). This is ~12k redundant blocking Ollama round-trips.
3. Each cluster found triggers a blocking Haiku call (`callFn`) to merge it.
4. A second full-table pass (`sanitize verbose singletons`) re-scans every non-superseded memory again for a possible Haiku sanitize call.
5. None of this reports incremental progress or accepts a scope/size limit — a caller has no way to run a bounded slice.

## Goals

- A single `nexus_distill` invocation always completes in bounded time, regardless of total memory table size.
- Eliminate the redundant per-memory re-embedding call — reuse the vector already stored in `memories_vec` when present.
- Let a caller scope a run to one project (or global) and/or cap how many candidate memories are considered, mirroring the existing `nexus_backfill` parameter pattern (`project`, `cwd`, `limit`, `dry_run`) already in `src/mcp/server.ts`.
- Report enough in the result (processed count vs. total eligible) that a caller knows whether to re-invoke to continue.
- Keep the "requires explicit prompt / not auto-allowed" behavior — no new parameter should make this tool auto-runnable in an allowlist; it still triggers LLM rewrite calls.

## Non-goals

- No persistent resumable cursor / job-state table (rejected approach — see design alternatives below). A caller re-invokes with `project`/`limit` as needed; that's an acceptable manual workflow for an on-demand maintenance tool.
- No background/async job execution or a new `nexus_distill_status` tool.
- No change to the clustering/merge quality logic (`BAND_LOW`, `MAX_CLUSTER`, prompts) — this is purely about bounding and scoping the run, not improving distillation quality.
- No change to `nexus_consolidate` — it already runs standalone and is unaffected.

## Constraints

None declared beyond the existing codebase conventions (flat structure, minimal abstraction, tabs, no speculative features — see `CLAUDE.md`).

## Proposed Approach

**Bounded pagination params**, mirroring `nexus_backfill`'s existing pattern:

1. **Fix the embedding-reuse bug**: before calling `embedFn(m.body)` in the clustering loop, check whether `m` already has a stored vector in `memories_vec` (it will, for any memory that survived `embedUnindexedMemories`) and reuse it instead of re-requesting an embedding. This alone removes ~12k redundant Ollama calls on the full set.
2. **Add scope params** to `distillMemories()` and the `nexus_distill` MCP tool:
   - `project?: string` — restrict the `all` query to one project slug (plus `cwd?: string` to derive it, same as `nexus_backfill`).
   - `limit?: number` — cap how many candidate memories are pulled into the clustering loop for this run (sane default, e.g. 200; hard cap similar to `nexus_backfill`'s 30-session cap, e.g. 500).
   - `dry_run?: boolean` — report how many memories are eligible/would be processed under the given scope, without calling the LLM.
3. **Bound the sanitize pass** the same way — it re-scans `all`, so once `all` is scoped/limited by (1)-(2) it's automatically bounded; no separate param needed.
4. **Report remaining work**: `DistillResult` gains a field (e.g. `eligibleRemaining` or similar) computed from a cheap `COUNT(*)` under the same scope filter minus what was just processed, so the tool's text response can tell the caller whether another invocation is needed to fully cover that scope.
5. Update the `nexus_distill` tool description in `server.ts` to document the new params, following the existing `nexus_backfill` tool's docstring style.

## Key Questions

- What are the right default/max values for `limit`? (Proposal: default 200, hard cap 500 — architect to confirm against expected cluster sizes and Haiku call cost per run.)
- Should `project` be required, or should an unscoped call still be allowed but forced through `limit`'s default cap? (Proposal: unscoped allowed, but `limit` default still applies — matches "safe by default" without forcing the caller to always specify a project.)
- Exact field name/shape for reporting "remaining" work in `DistillResult` / the tool's text response — architect to finalize alongside the existing `embedded/clusters/merged/created/sanitized` fields.
- Does `project` scoping need a `global` special-case (memories with `scope: 'global'` have `project` possibly null) similar to how `nexus_backfill`/other tools resolve project scope elsewhere in the codebase? Architect should check `resolveProjectFromCwd` and existing scope-filter helpers for the established convention.

## Success Criteria

- Calling `nexus_distill` with a `project` + default `limit` on the full 12k-memory / 40+-project DB completes without hanging and without a manual kill, in observably bounded time (single call processes at most `limit` memories).
- A test reproduces the original bug shape (many memories, all already embedded) and asserts `embedFn`/the embedding-generation function is **not** called again for memories that already have a stored vector — i.e. asserts the redundant-embedding fix via call-count assertions on the injected `embedFn` mock (the function already accepts injectable `embedFn`/`callFn` for testing, per its signature).
- A test asserts that with `limit` set, `distillMemories()` considers at most `limit` candidate memories from the eligible pool, regardless of total table size.
- A test asserts that with `project` set, only memories matching that project (and matching scope rules) are eligible for clustering.
- `dry_run: true` returns eligibility/would-process counts without invoking `callFn` (no LLM calls made).
- Existing `distill.test.ts` behavior (clustering, merge, sanitize, supersede/link bookkeeping) continues to pass unchanged for the unscoped/no-limit case (backward compatible default behavior mirrors today's semantics apart from the embedding-reuse fix).
