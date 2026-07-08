---
# INTENTS: task-003 — Add promotion_target to MemoryCandidate + PROMOTION_TARGETS set + SYSTEM_PROMPT classification block

## Task
```json
{
  "id": "task-003",
  "files": ["src/capture/extract.ts"],
  "depends_on": ["task-001"],
  "estimated_tokens": 3200,
  "complexity": "complex",
  "constraints": ["D-008"],
  "risk": "medium"
}
```

## Reviewer verdict
```json
{"verdict":"PASS","task_id":"task-003","issues":[],"summary":"All three scoped changes are correctly implemented: MemoryCandidate gains promotion_target: PromotionTarget with the import from ../core/types.js; PROMOTION_TARGETS set matches spec values exactly; classification block in SYSTEM_PROMPT is verbatim-identical to spec, correctly placed; JSON output-keys sentence updated. parseCandidates/refineCandidates untouched (deferred to task-004/005 as expected). D-008 satisfied."}
```

## Meta
- timestamp: 2026-07-08T00:15:00Z
- model: sonnet (implementer), sonnet (reviewer)
- Expected deferred tsc errors: parseCandidates push (task-004), several test fixtures (task-004/task-010)
---
