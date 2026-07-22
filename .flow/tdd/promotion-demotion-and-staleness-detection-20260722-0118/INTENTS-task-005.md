---
# INTENTS: task-005 — Add detectContradictions signature + stub to governance.ts (GATED behind DDR)

## Task
{
  "id": "task-005",
  "title": "Add detectContradictions signature + stub to governance.ts (GATED behind DDR)",
  "files": ["src/core/governance.ts", "src/core/llm.ts"],
  "depends_on": ["task-001", "task-002"],
  "risk": "low"
}

## Gate check
DDR-005 (_documents/decisions/ddr-005-contradiction-detection-design-heuristic-pre-filte.md)
landed in task-002, before this task ran. Gate satisfied.

## Reviewer verdict
{
  "verdict": "PASS",
  "summary": "detectContradictions has the exact required signature and stub body, callModel imported and matches HaikuFn, governByHelpRate and constants unmodified. tsc and existing test suite pass."
}

## Meta
- timestamp: 2026-07-22T00:25:00Z
- model: sonnet (implementer), sonnet (reviewer)
---
