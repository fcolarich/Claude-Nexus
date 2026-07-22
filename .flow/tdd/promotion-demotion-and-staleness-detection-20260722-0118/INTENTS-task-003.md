---
# INTENTS: task-003 — Unit tests for governByHelpRate (all branches)

## Task
{
  "id": "task-003",
  "title": "Unit tests for governByHelpRate (all branches)",
  "files": ["src/core/governance-helprate.test.ts", "src/core/governance.ts", "src/core/database.ts"],
  "depends_on": ["task-001"],
  "risk": "low"
}

## Reviewer verdict
{
  "verdict": "PASS",
  "summary": "Tests for governByHelpRate cover all required branches (demote, reinforce, dead-zone, below-MIN_EVALUATIONS, use_count==5 boundary, floor/cap clamps, approved+non-superseded filtering with pending/superseded rows seeded and asserted untouched, and an aggregate GovernResult check). All 7 reported failures assert genuine state changes the stub cannot produce (correct red-state failures, not broken fixtures); 2 tests pass coincidentally since their assertions are 'nothing changes'."
}

## Notes
Fixed one implementer bug before review: the superseded-row test seeded
`superseded_by: 'some-other-id'` without first inserting that row, tripping the
`memories(id)` FK. Fixed by seeding the winner row first.

## Meta
- timestamp: 2026-07-22T00:15:00Z
- model: sonnet (implementer), sonnet (reviewer)
---
