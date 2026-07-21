---
# INTENTS: task-008 — Create pure rrfFuse helper

## Task
{
  "id": "task-008",
  "title": "Create pure rrfFuse helper",
  "description": "TDD: create src/core/rrf.test.ts asserting the fusion math — known ranked lists fuse to expected order, an id missing from a list contributes 0 from that list, single-list input preserves order, empty input returns [], scores use sum(1/(k+rank)). Then create src/core/rrf.ts exporting RRF_K = 60 and rrfFuse(rankedLists: number[][], k = RRF_K): Array<{id: number; score: number}> sorted by fused score desc. Pure, storage-agnostic, no DB/embedding imports. Acceptance: rrf.test.ts passes.",
  "files": ["src/core/rrf.ts", "src/core/rrf.test.ts"],
  "depends_on": ["task-007"],
  "estimated_tokens": 2200,
  "complexity": "simple",
  "constraints": ["Q2"],
  "risk": "low"
}

## Reviewer verdict
{
  "verdict": "PASS",
  "task_id": "task-008",
  "issues": [],
  "summary": "RRF_K=60 exported, rrfFuse signature matches spec, formula is sum(1/(k+rank)) with 1-indexed rank, duplicates handled correctly (first position wins, rank still advances), missing ids contribute 0, empty input returns [], k<=0 throws. No DB or embedding imports. All 11 tests carry exact numeric assertions with toBeCloseTo(..., 10)."
}

## Meta
- timestamp: 2026-07-22T00:16:00Z
- model: sonnet (implementer), sonnet (reviewer)
- verification: `npx vitest run src/core/rrf.test.ts` -> 11 passed, 11 total.
---
