---
# INTENTS: task-005 — refineCandidates forces promotion_target='none' on restatements; add force-none tests

## Task
```json
{
  "id": "task-005",
  "files": ["src/capture/extract.ts", "src/capture/extract.test.ts"],
  "depends_on": ["task-004"],
  "estimated_tokens": 2400,
  "complexity": "simple",
  "constraints": [],
  "risk": "low"
}
```

## Reviewer verdict
```json
{"verdict":"PASS","task_id":"task-005","issues":[],"summary":"All three verification points confirmed. Line 159 explicitly sets promotion_target:'none' in the restatement branch via object spread override. Gate condition and body split/append logic unmodified. Both new tests present and meaningful. 25/25 tests pass."}
```

## Meta
- timestamp: 2026-07-08T00:30:00Z
- model: sonnet (implementer), sonnet (reviewer)
- extract.test.ts: 25/25 tests passing
---
