---
# INTENTS: task-007 — Bound the sanitize-verbose-singletons pass to the scoped pool

## Task
{
  "id": "task-007",
  "title": "Bound the sanitize-verbose-singletons pass to the scoped pool",
  "description": "In src/core/distill.ts change the second 'sanitize verbose singletons' pass so it iterates the same scoped/limited candidate pool used by the clustering loop instead of a fresh full-table scan, so the whole run is bounded. Add a unit test in src/core/distill.test.ts asserting the sanitize pass only passes in-scope memories to callFn and leaves out-of-scope memories untouched.",
  "files": ["src/core/distill.ts", "src/core/distill.test.ts", ".flow/tdd/nexus-distill-chunking-20260724-1429/impl-spec.md"],
  "depends_on": ["task-006"],
  "estimated_tokens": 10000,
  "complexity": "simple",
  "constraints": [],
  "risk": "low"
}

## Reviewer verdict
{
  "verdict": "PASS",
  "task_id": "task-007",
  "issues": [],
  "summary": "distill.ts required no change — sanitize pass already iterated the scoped/limited `all` array as a side effect of task-004's wiring. Task's real deliverable was test coverage, added and structurally verified. One test-authoring bug found and fixed during orchestrator verification: identical bodies across in-scope/out-of-scope test memories caused an insertMemory content-hash id collision (INSERT OR IGNORE silently merged both into one row) — fixed with distinct bodies."
}

## Meta
- timestamp: 2026-07-24T15:45:30Z
- model: sonnet (implementer), sonnet (reviewer)
- orchestrator verification: caught a real test bug via `npx vitest run` (content-hash id collision from identical test memory bodies), sent back for fix; re-verified npx tsc --noEmit clean, npx vitest run src/core/distill.test.ts — 26/26 pass
---
