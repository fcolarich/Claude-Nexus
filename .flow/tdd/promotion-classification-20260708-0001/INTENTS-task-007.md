---
# INTENTS: task-007 — Migration v9 tests: columns present, partial index, idempotency, pre-existing rows default 'none'

## Task
```json
{
  "id": "task-007",
  "files": ["src/core/database.test.ts"],
  "depends_on": ["task-006"],
  "estimated_tokens": 2600,
  "complexity": "simple",
  "constraints": ["D-002"],
  "risk": "low"
}
```

## Reviewer verdict
```json
{"verdict":"PASS","task_id":"task-007","issues":[{"severity":"nit","location":"src/core/database.test.ts:183-192","note":"v9-specific idempotency test is functionally identical to the general one at line 78. Non-blocking."}],"summary":"All five acceptance criteria met: columns present + schema version 9, partial index confirmed, idempotency tested via existing pattern, column default 'none' verified, conventions followed."}
```

## Meta
- timestamp: 2026-07-08T00:25:00Z
- model: sonnet (implementer), sonnet (reviewer)
- database.test.ts: 14/14 tests passing (9 pre-existing + 5 new)
---
