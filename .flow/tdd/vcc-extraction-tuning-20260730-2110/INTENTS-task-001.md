---
# INTENTS: task-001 — Add phase-section-cue instruction to SYSTEM_PROMPT

## Task
```json
{
  "id": "task-001",
  "title": "Add phase-section-cue instruction to SYSTEM_PROMPT",
  "files": ["src/capture/extract.ts", "src/capture/extract.test.ts"],
  "depends_on": [],
  "estimated_tokens": 3500,
  "complexity": "simple",
  "constraints": [],
  "risk": "low"
}
```

## Reviewer verdict
```json
{
  "verdict": "PASS",
  "task_id": "task-001",
  "issues": [],
  "summary": "Single-sentence insertion into SYSTEM_PROMPT's Rules block, placed before the STRICT JSON output rule as specified. extract.test.ts correctly left untouched — verified no SYSTEM_PROMPT literal-content assertion exists. Matches acceptance criteria; no new brittle prompt-wording test added, per explicit constraint."
}
```

## Meta
- timestamp: 2026-07-30T00:00:00Z
- model: sonnet (implementer), sonnet (reviewer)
---
