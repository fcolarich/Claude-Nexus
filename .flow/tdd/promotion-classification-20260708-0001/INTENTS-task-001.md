---
# INTENTS: task-001 — Add PromotionTarget union type to types.ts

## Task
```json
{
  "id": "task-001",
  "title": "Add PromotionTarget union type to types.ts",
  "description": "In src/core/types.ts, add `export type PromotionTarget = 'none' | 'adr' | 'ddr' | 'best_practice' | 'recipe' | 'note';` next to MemoryType (currently line 9). Type declaration only — no Memory-interface change here (that is task-002). No runtime code, compiler is the check.",
  "files": ["src/core/types.ts"],
  "depends_on": [],
  "estimated_tokens": 1200,
  "complexity": "simple",
  "constraints": [],
  "risk": "low"
}
```

## Reviewer verdict
```json
{"verdict":"PASS","task_id":"task-001","issues":[],"summary":"PromotionTarget union type added at line 10, immediately after MemoryType, with exactly the six specified values ('none' | 'adr' | 'ddr' | 'best_practice' | 'recipe' | 'note'). Memory interface untouched. Placement and value set match the spec exactly. No runtime code introduced."}
```

## Meta
- timestamp: 2026-07-08T00:00:00Z
- model: sonnet (implementer), sonnet (reviewer)
- typecheck: `npx tsc --noEmit` clean (verified by orchestrator directly)
---
