---
# INTENTS: task-009 — insertMemory round-trip test for promotion_target

## Task
```json
{"id": "task-009", "files": ["src/core/memories.test.ts"], "depends_on": ["task-008"], "risk": "low", "constraints": ["D-001"]}
```

## Reviewer verdict
```json
{"verdict":"PASS","task_id":"task-009","issues":[],"summary":"Round-trip test correctly inserts promotion_target='adr' via insertMemory and asserts getMemory returns promotion_target='adr' with promoted_to=null. freshDb() calls initializeSchema ensuring migration v9 applies. Fixture updated in-scope."}
```

## Meta
- timestamp: 2026-07-08T00:40:00Z
- model: sonnet (implementer), sonnet (reviewer)
- memories.test.ts: 7/7 tests passing
---
