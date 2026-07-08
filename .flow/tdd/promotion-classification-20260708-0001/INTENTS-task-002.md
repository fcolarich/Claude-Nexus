---
# INTENTS: task-002 — Add promotion_target and promoted_to to the Memory interface

## Task
```json
{
  "id": "task-002",
  "title": "Add promotion_target and promoted_to to the Memory interface",
  "files": ["src/core/types.ts"],
  "depends_on": ["task-001"],
  "estimated_tokens": 1200,
  "complexity": "simple",
  "constraints": [],
  "risk": "low"
}
```

## Reviewer verdict
```json
{"verdict":"PASS","task_id":"task-002","issues":[],"summary":"Memory interface correctly extended with promotion_target: PromotionTarget (non-nullable, mirrors DB DEFAULT 'none') and promoted_to: string | null (nullable FK). Field placement, types, and nullability all match the task description and expected migration v9 schema. No runtime logic introduced; test coverage requirement does not apply to a pure type extension."}
```

## Meta
- timestamp: 2026-07-08T00:10:00Z
- model: sonnet (implementer), sonnet (reviewer)
---
