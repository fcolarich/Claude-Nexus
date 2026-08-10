# Plan: nexus_search_session — compacted-first session content search

**Branch:** `feature/compacted-first-search`
**Complexity:** simple (additive feature, finalized architecture, no open questions) — planned with Sonnet
**Total tasks:** 7 | **Estimated tokens:** 27,500

## Task Table

| ID | Title | Files | Depends On | Risk | Tokens |
|----|-------|-------|------------|------|--------|
| task-001 | `grepText` pure substring matcher | src/core/text-search.ts (+test) | — | low | 3500 |
| task-002 | Migration v13 — `session_search_log` table | src/core/database.ts (+test) | — | high | 3500 |
| task-003 | `getSessionById` + `logSessionSearch` helpers | src/core/search.ts (+test) | task-002 | low | 4000 |
| task-004 | `searchSession` orchestrator (compacted-first, fallback, fail-open, never-throw) | src/core/search.ts (+test) | task-001, task-003 | medium | 6500 |
| task-005 | `getStats()` additive session-search fields | src/core/search.ts (+test) | task-004 | low | 3000 |
| task-006 | `nexus_search_session` MCP tool registration | src/mcp/server.ts (+test) | task-004 | high | 4500 |
| task-007 | Extend `nexus_stats` rendering with session-search line | src/mcp/server.ts (+test) | task-005, task-006 | low | 2500 |

## Parallelizable

- task-001 + task-002 (no deps, different files)
- task-005 + task-006 (after task-004 lands, different files)

## Coverage

All 8 acceptance criteria from design.md (new tool, compacted-first w/ fallback, usage tracking via nexus_stats, never-throw error paths, one log row per call, additive getStats, zero regressions) are covered — see the full AC→task matrix in the planner's checkpoint output and `impl-spec.md`.

## Notes

- task-002 (migration) and task-006 (new public MCP tool surface) are risk:high per the planner's rubric, despite being straightforward additive changes.
- task-004 is the only complexity:complex task — the fallback ladder with 6 branches (compacted hit / compacted miss→fallback / no shrunk path / no matches anywhere / session not found / no content) is the one place requiring real judgment; kept as a single task since the feature is SIMPLE-classified, with guidance to commit incrementally per branch.
- task-005 and task-007 are chained after task-004/task-006 purely to avoid two tasks concurrently editing the same file, not due to a logical dependency.

Full detail: `impl-spec.md`, `tasks.json` in this directory.
