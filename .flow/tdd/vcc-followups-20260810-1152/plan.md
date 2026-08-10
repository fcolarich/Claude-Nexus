# Plan: VCC follow-ups (transcript_path exposure + parallel-file auto-compact)

Branch: `feature/vcc-followups`

## Tasks

| ID | Title | Files | Depends On | Tokens | Risk |
|----|-------|-------|------------|--------|------|
| task-001 | Write failing test: transcript_path in nexus_sessions output | src/mcp/server.test.ts | — | 3000 | low |
| task-002 | Implement transcript_path field in nexus_sessions formatter | src/mcp/server.ts | task-001 | 2500 | low |
| task-003 | Write failing test: migration v12 adds sessions.vcc_shrunk_path | src/core/database.test.ts | — | 2500 | low |
| task-004 | Implement migration v12 'vcc-shrunk-path' | src/core/database.ts | task-003 | 3000 | high |
| task-005 | Write failing tests: parallelShrunkPath + compactToParallelFile success path | src/capture/vcc-bridge.test.ts | — | 4000 | low |
| task-006 | Implement compactToParallelFile success path, parallelShrunkPath, ParallelCompactResult | src/capture/vcc-bridge.ts | task-005 | 5500 | high |
| task-007 | Write failing tests: compactToParallelFile failure/safety path | src/capture/vcc-bridge.test.ts | task-006 | 4000 | low |
| task-008 | Implement CompactTargetGuard and failure-path handling in compactToParallelFile | src/capture/vcc-bridge.ts | task-007 | 4500 | high |
| task-009 | Write failing tests: reflect() parallel-compact trigger | src/capture/reflector.test.ts | task-004, task-008 | 5000 | low |
| task-010 | Implement end-of-reflect() parallel-compact trigger | src/capture/reflector.ts | task-009 | 6000 | high |

Total estimated tokens: 40,000

## Parallel tracks

Three independent tracks can start immediately in parallel (no shared files):
- task-001 → task-002 (mcp/server.ts)
- task-003 → task-004 (database.ts)
- task-005 → task-006 → task-007 → task-008 (vcc-bridge.ts)

task-009/task-010 (reflector.ts) wait for both task-004 and task-008.

## Coverage matrix

| Acceptance Criterion | Covered by |
|---|---|
| AC-1: `nexus_sessions` output includes `transcript_path` per session, zero new DB reads | task-001, task-002 |
| AC-2: Over-threshold unprocessed window triggers `compactToParallelFile` from `reflect()` and sets `vcc_shrunk_path` | task-009, task-010 |
| AC-3: Under-threshold window makes no VCC call, `vcc_shrunk_path` left untouched | task-009, task-010 |
| AC-4: `compactToParallelFile` success path writes sibling `${jsonlPath}.vcc-shrunk.jsonl`, returns `{ ok: true, path }`, original file untouched | task-005, task-006 |
| AC-5: `compactToParallelFile` CLI-failure path structurally incapable of targeting `jsonlPath` (ADR-015 hard constraint) | task-007, task-008 |
| AC-6: `reflect()` trigger CLI-failure path leaves `vcc_shrunk_path` NULL, does not throw or abort `reflect()` | task-009, task-010 |
| AC-7: Migration v12 adds `sessions.vcc_shrunk_path` (nullable TEXT, default NULL), idempotent, mirrors v10 test | task-003, task-004 |
| AC-8: `npm test` passes with no regressions; disabled `compactFileInPlace` block (`reflector.ts:274-288`) remains untouched | task-009, task-010 |

Artifacts: `impl-spec.md`, `tasks.json` in this directory.
