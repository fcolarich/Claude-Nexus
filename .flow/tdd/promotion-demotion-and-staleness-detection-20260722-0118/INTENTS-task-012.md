---
# INTENTS: task-012 — Wire phase 4 (governByHelpRate) into consolidateMemories

## Task
{
  "id": "task-012",
  "title": "Wire phase 4 (governByHelpRate) into consolidateMemories",
  "files": ["src/core/consolidate.ts", "src/core/governance.ts"],
  "depends_on": ["task-004"],
  "risk": "medium"
}

## Reviewer verdict
{
  "verdict": "PASS",
  "summary": "governByHelpRate correctly wired after the merge phase (backfill -> prune -> merge -> govern). ConsolidateResult additively extended; signature unchanged, existing callers unaffected. No detectContradictions reference. governance.ts untouched."
}

## Meta
- timestamp: 2026-07-22T01:35:00Z
- model: sonnet (implementer), sonnet (reviewer)
---
