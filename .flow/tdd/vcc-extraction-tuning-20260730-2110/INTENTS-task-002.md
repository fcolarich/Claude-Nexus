---
# INTENTS: task-002 — Source-aware MAX_CANDIDATES capping (vcc vs generic)

## Task
```json
{
  "id": "task-002",
  "title": "Source-aware MAX_CANDIDATES capping (vcc vs generic)",
  "files": ["src/capture/extract.ts", "src/capture/reflector.ts", "src/capture/extract.test.ts"],
  "depends_on": [],
  "estimated_tokens": 6500,
  "complexity": "simple",
  "constraints": [],
  "risk": "medium"
}
```

## Reviewer verdict
```json
{
  "verdict": "PASS",
  "task_id": "task-002",
  "issues": [
    {
      "severity": "nit",
      "location": "src/capture/extract.ts SYSTEM_PROMPT",
      "note": "Phase-heading rule line belongs to task-001, appears in diff only because nothing committed yet — not new scope creep."
    }
  ],
  "summary": "Implementation matches spec precisely. MAX_CANDIDATES_GENERIC/VCC constants, parseCandidates(raw, maxCandidates) default, Extractor + extractMemories ctx gain source?, resolution logic correct, reflector derives source and passes through extract(). Tests cover vcc>20-cap-40, generic-cap-20, omitted-cap-20; all 30 extract.test.ts tests pass. One pre-existing unrelated reflector.test.ts failure (vcc_shrunk_at), confirmed via git stash against clean baseline."
}
```

## Meta
- timestamp: 2026-07-30T20:55:00Z
- model: sonnet (implementer), sonnet (reviewer)
---
