---
# INTENTS: task-010 — Unit tests for self-heal diagnostic re-derivation

## Task
{
  "id": "task-010",
  "title": "Unit tests for self-heal diagnostic re-derivation",
  "files": ["src/core/governance-contradictions.test.ts", "src/core/governance.ts", "src/core/database.ts"],
  "depends_on": ["task-009"],
  "risk": "low"
}

## Reviewer verdict
{
  "verdict": "PASS",
  "summary": "Three tests added, correctly red on the two re-derivation tests (self-heal not implemented yet), green on the no-duplicate test. Wipe simulated via raw DELETE, no decay.ts import. Throwing fake proves haikuFn must never be invoked for already-contradicts pairs. Re-derived shape matches task-009's writer exactly."
}

## Meta
- timestamp: 2026-07-22T01:15:00Z
- model: sonnet (implementer), sonnet (reviewer)
---
