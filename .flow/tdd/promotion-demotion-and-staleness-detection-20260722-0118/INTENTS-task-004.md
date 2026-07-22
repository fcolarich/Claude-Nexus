---
# INTENTS: task-004 — Implement governByHelpRate (phase 4 — pure SQL)

## Task
{
  "id": "task-004",
  "title": "Implement governByHelpRate (phase 4 — pure SQL)",
  "files": ["src/core/governance.ts", "src/core/database.ts"],
  "depends_on": ["task-001", "task-003"],
  "risk": "medium"
}

## Reviewer verdict
{
  "verdict": "PASS",
  "summary": "governByHelpRate correctly implements the spec: parameterized SQL, transaction-wrapped loop, branch logic matches exactly, all three branches reset counts/updated_at. decay.ts untouched; no schema changes. All 9 tests pass."
}

## Meta
- timestamp: 2026-07-22T00:20:00Z
- model: sonnet (implementer), sonnet (reviewer)
---
