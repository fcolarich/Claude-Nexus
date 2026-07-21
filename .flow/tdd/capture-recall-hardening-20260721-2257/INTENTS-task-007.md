---
# INTENTS: task-007 — Cap MEMORY.md index with truncation pointer

## Task
{
  "id": "task-007",
  "title": "Cap MEMORY.md index with truncation pointer",
  "description": "TDD: extend export.test.ts with a large synthetic per-bucket memory set exceeding the cap, asserting the written MEMORY.md index is capped at capture.memory_md_max_items entries, retains the top entries by decay rank desc, and appends exactly one pointer line '> … {remaining} more memories — use nexus_search to retrieve them.' with correct remaining count; plus an under-cap case with no pointer and no truncation. Then implement in exportAll() (src/capture/export.ts): per bucket order approved memories by decay rank desc, keep top N = config.capture.memory_md_max_items, append the pointer line only on overflow. Acceptance: SC-4 passes; existing export.test.ts green.",
  "files": ["src/capture/export.ts", "src/capture/export.test.ts"],
  "depends_on": ["task-006"],
  "estimated_tokens": 4000,
  "complexity": "simple",
  "constraints": ["Q5"],
  "risk": "low"
}

## Correction applied
The implementer's overflow test used `not.toContain('Cap Mem 1')`-style substring
checks, which false-collide with "Cap Mem 100".."Cap Mem 199" etc. The orchestrator
fixed this directly by bracket-anchoring to `[Cap Mem ${i}]` (matching the literal
markdown link-text boundary), making each check unambiguous. This was the only
manual correction; the rest is the implementer's original work.

## Reviewer verdict
{
  "verdict": "PASS",
  "task_id": "task-007",
  "issues": [],
  "summary": "Individual .md files written for all memories (no data loss); MEMORY.md index capped to top-N by decay rank desc per bucket. Pointer line format and strict > overflow condition match spec exactly. All three test cases (overflow at 205, under-cap at 10, exactly-at-cap at 200) present and meaningful. Tie-breaking deterministic via stable sort + deterministic SQL fetch order."
}

## Meta
- timestamp: 2026-07-22T00:14:00Z
- model: sonnet (implementer), sonnet (reviewer)
- verification: `npx vitest run src/capture/export.test.ts` -> 7 passed, 7 total.
---
