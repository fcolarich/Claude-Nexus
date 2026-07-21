---
# INTENTS: task-006 — Add capture.memory_md_max_items default

## Task
{
  "id": "task-006",
  "title": "Add capture.memory_md_max_items default",
  "description": "Add capture.memory_md_max_items = 200 to the baked-in DEFAULTS in src/core/config.ts (new key consumed by export.ts). getNexusConfig() merge logic unchanged; yaml may override. Do NOT touch reranker here. Acceptance: getNexusConfig().capture.memory_md_max_items === 200 when yaml omits the key (validated downstream by export.test.ts in task-007).",
  "files": ["src/core/config.ts"],
  "depends_on": ["task-002"],
  "estimated_tokens": 1800,
  "complexity": "simple",
  "constraints": ["Q5"],
  "risk": "low"
}

## Reviewer verdict
{
  "verdict": "PASS",
  "task_id": "task-006",
  "issues": [],
  "summary": "memory_md_max_items: number added to NexusConfig.capture interface and memory_md_max_items: 200 to DEFAULTS.capture. reranker block untouched. getNexusConfig() merge logic unchanged (spread picks up new key automatically). No test file added here, correct per scope (config.test.ts arrives in task-012)."
}

## Meta
- timestamp: 2026-07-22T00:06:00Z
- model: sonnet (implementer), sonnet (reviewer)
---
