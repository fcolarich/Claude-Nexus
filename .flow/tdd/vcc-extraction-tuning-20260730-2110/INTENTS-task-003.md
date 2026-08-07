---
# INTENTS: task-003 — Fixture + test coverage for validated-supersede fail-closed behavior (TDD red)

## Task
```json
{
  "id": "task-003",
  "title": "Fixture + test coverage for validated-supersede fail-closed behavior (TDD red)",
  "files": ["src/capture/reflector.test.ts", "src/capture/docspine.ts", "src/capture/reflector.ts"],
  "depends_on": [],
  "estimated_tokens": 8500,
  "complexity": "complex",
  "constraints": [],
  "risk": "low"
}
```

## Reviewer verdict
```json
{
  "verdict": "PASS",
  "task_id": "task-003",
  "issues": [],
  "summary": "Fixture makeDecisions() correctly mirrors docspine.ts's readDecisionIndex() convention: join(cwd, '_documents', 'decisions'), short-form filename adr-NNN-slug.md, id derivation yields 'ADR-042' matching refCand's citation. Retrofitted tests only added cwd param, no assertions changed. 2 new tests correctly exercise fail-closed behavior. Suite: 16 passed, 2 new tests failing as intended (TDD red, expected), 1 pre-existing unrelated failure (vcc_shrunk_at)."
}
```

## Meta
- timestamp: 2026-07-30T21:05:00Z
- model: sonnet (implementer), sonnet (reviewer)
- note: expected red state — 2 new tests will not pass until task-004 lands
---
