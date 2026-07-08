---
# INTENTS: task-008 — Add promotion_target to MemoryInput and the insertMemory INSERT (D-001)

## Task
```json
{
  "id": "task-008",
  "files": ["src/core/memories.ts"],
  "depends_on": ["task-002", "task-006"],
  "estimated_tokens": 2200,
  "complexity": "simple",
  "constraints": ["D-001"],
  "risk": "medium"
}
```

## Reviewer verdict
```json
{"verdict":"PASS","task_id":"task-008","issues":[],"summary":"MemoryInput gains promotion_target: PromotionTarget as required field, imported correctly. insertMemory's INSERT OR IGNORE includes promotion_target in column list, VALUES, and params, correctly bound. No ON CONFLICT DO UPDATE added (D-001 respected). promoted_to correctly absent — stays NULL via column default."}
```

## Meta
- timestamp: 2026-07-08T00:32:00Z
- model: sonnet (implementer), sonnet (reviewer)
- Note: making promotion_target required surfaced broad compile fallout across the repo (backfill.test.ts, export.test.ts, project-migrate.test.ts, prune.test.ts, distill.ts/distill.test.ts, lifecycle.test.ts, memories.test.ts, recall.test.ts, integration.test.ts, mcp/server.ts) beyond task-010's originally-scoped files array (reflector.ts/reflector.test.ts only). This is expected per impl-spec.md's edge-case note ("grep those fixtures... this is expected fallout... part of keeping the ~107 green"). task-010's actual dispatch will be widened to cover all fallout files to satisfy AC-4.
---
