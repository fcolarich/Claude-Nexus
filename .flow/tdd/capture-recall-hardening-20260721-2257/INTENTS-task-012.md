---
# INTENTS: task-012 — Flip reranker enabled default to true

## Task
{
  "id": "task-012",
  "title": "Flip reranker enabled default to true",
  "description": "TDD: add src/core/config.test.ts asserting getNexusConfig().reranker.enabled === true when extraction_models.yaml omits reranker.enabled, and that an explicit yaml reranker.enabled: false still wins. Then flip DEFAULTS.reranker.enabled from false to true in src/core/config.ts (was config.ts:94); getNexusConfig() merge logic unchanged. Land only after task-011's latency confirmation. Acceptance: SC-6 config test passes; a fresh install with no yaml key gets reranked recall.",
  "files": ["src/core/config.ts", "src/core/config.test.ts"],
  "depends_on": ["task-011"],
  "estimated_tokens": 2800,
  "complexity": "simple",
  "constraints": ["Q3"],
  "risk": "medium"
}

## Reviewer verdict
{
  "verdict": "PASS",
  "task_id": "task-012",
  "issues": [],
  "summary": "DEFAULTS.reranker.enabled flipped to true; capture.memory_md_max_items untouched; getNexusConfig() merge logic unchanged. Test isolation real: vi.resetModules() + vi.doMock('fs', ...) intercepts before dynamic import so the real extraction_models.yaml on disk is never read. Both cases assert meaningful outcomes."
}

## Meta
- timestamp: 2026-07-22T00:56:00Z
- model: sonnet (implementer), sonnet (reviewer)
- verification: `npx vitest run src/core/config.test.ts src/core/recall.test.ts src/core/search.test.ts` -> 39 passed, 39 total.
---
