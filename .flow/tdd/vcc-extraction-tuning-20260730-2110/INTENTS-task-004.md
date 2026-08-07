---
# INTENTS: task-004 — Implement isReferenceUpgrade fail-closed validIds check (TDD green)

## Task
```json
{
  "id": "task-004",
  "title": "Implement isReferenceUpgrade fail-closed validIds check (TDD green)",
  "files": ["src/capture/reflector.ts"],
  "depends_on": ["task-002", "task-003"],
  "estimated_tokens": 6000,
  "complexity": "simple",
  "constraints": [],
  "risk": "medium"
}
```

## Reviewer verdict
```json
{
  "verdict": "PASS",
  "task_id": "task-004",
  "issues": [],
  "summary": "isReferenceUpgrade correctly fails closed: shape checks first, then extracts ADR/DDR id via non-global ADR_REF_RE, uppercases, requires validIds.has(id) — false on unextractable id or empty validIds. validIds derived from readDecisionIndex(opts.cwd) via d.split(':')[0].trim().toUpperCase(). reflect()'s exported signature and ReflectResult shape untouched. Tests: 18 passed / 1 pre-existing unrelated failure (vcc_shrunk_at). Solid coverage including empty-validIds edge case."
}
```

## Meta
- timestamp: 2026-07-30T21:12:00Z
- model: sonnet (implementer), sonnet (reviewer)
---
