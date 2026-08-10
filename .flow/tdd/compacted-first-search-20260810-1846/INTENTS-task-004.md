# task-004: Implement searchSession orchestrator (compacted-first, fallback, fail-open)
Files: src/core/search.ts, src/core/search.test.ts
Reviewer verdict: PASS (standard review, risk: medium) - 1 warning, 1 nit, non-blocking
Timestamp: 2026-08-10T17:28:00Z
Models: implementer=sonnet, reviewer=tdd-reviewer
Notes: exported type is named SessionWithVccPath (not SessionRow as architecture.md specified) - IMPORTANT for task-006: import SessionWithVccPath, not SessionRow, if referencing the type. All 7 spec points verified: not-found, compacted-hit, 3 fallback triggers (null path/missing file/zero matches), no-matches, no-content, single fail-open log call per terminal path, function never throws.
