---
# INTENTS: task-006 — Add migration v9 (promotion-classification) to database.ts

## Task
```json
{
  "id": "task-006",
  "title": "Add migration v9 (promotion-classification) to database.ts",
  "files": ["src/core/database.ts"],
  "depends_on": [],
  "estimated_tokens": 2400,
  "complexity": "complex",
  "constraints": ["D-002"],
  "risk": "medium"
}
```

## Reviewer verdict
```json
{"verdict":"PASS","task_id":"task-006","issues":[],"summary":"Migration v9 is correctly implemented. MIGRATIONS[] entry appended at version 9 with matching name and function reference. Both ALTER TABLE statements are wrapped in swallowed try/catch per D-002. CHECK constraint enumeration exactly matches spec ('none','adr','ddr','best_practice','recipe','note'). promoted_to column is nullable with no default (correct). Partial index uses IF NOT EXISTS and the correct WHERE predicate. LATEST_SCHEMA_VERSION auto-derives without manual change."}
```

## Meta
- timestamp: 2026-07-08T00:05:00Z
- model: sonnet (implementer), sonnet (reviewer)
- full suite: 143/143 passing after this + task-001
---
