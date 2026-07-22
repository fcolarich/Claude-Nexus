---
# INTENTS: task-006 — Unit tests for detectContradictions candidate selection + skip-on-failure

## Task
{
  "id": "task-006",
  "title": "Unit tests for detectContradictions candidate selection + skip-on-failure",
  "files": ["src/core/governance-contradictions.test.ts", "src/core/governance.ts", "src/core/database.ts"],
  "depends_on": ["task-005"],
  "risk": "low"
}

## Reviewer verdict
{
  "verdict": "PASS",
  "summary": "Test file is well-formed and covers every item in the required shortlist contract. 15 tests, 6 fail (expected red state against the stub), 9 pass (exclusion-path assertions coincidentally hold). No blockers."
}

## Meta
- timestamp: 2026-07-22T00:35:00Z
- model: sonnet (implementer), sonnet (reviewer)
---
