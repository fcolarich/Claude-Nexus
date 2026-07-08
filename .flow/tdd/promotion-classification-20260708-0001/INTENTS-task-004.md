---
# INTENTS: task-004 — parseCandidates validates promotion_target, defaults 'none'; add parse tests

## Task
```json
{
  "id": "task-004",
  "files": ["src/capture/extract.ts", "src/capture/extract.test.ts"],
  "depends_on": ["task-003"],
  "estimated_tokens": 2600,
  "complexity": "simple",
  "constraints": [],
  "risk": "low"
}
```

## Reviewer verdict
```json
{"verdict":"PASS","task_id":"task-004","issues":[],"summary":"All five acceptance criteria are met. parseCandidates reads o.promotion_target and validates it against PROMOTION_TARGETS, defaulting to 'none' for missing or invalid values — mirrors the scope/decay_class pattern exactly. promotion_target is included in every pushed MemoryCandidate. Tests cover all six valid values via it.each, missing field -> 'none' (AC-5 backward compat), and invalid value -> 'none'. refineCandidates untouched. No files outside declared scope touched."}
```

## Meta
- timestamp: 2026-07-08T00:20:00Z
- model: sonnet (implementer), sonnet (reviewer)
- extract.test.ts: 23/23 tests passing
---
