---
# INTENTS: task-009 — Refactor hybridSearchMemories onto rrfFuse

## Task
{
  "id": "task-009",
  "title": "Refactor hybridSearchMemories onto rrfFuse",
  "description": "Refactor hybridSearchMemories() in src/core/search.ts to build its FTS5-ranked and vector-ranked id lists and delegate fusion to rrfFuse([ftsIds, vecIds]) instead of its inlined RRF loop, then hydrate rows in fused order. Public signature and external behavior unchanged; atoms-side hybridSearch() intentionally left untouched. Keep/extend search.ts-adjacent tests (src/core/search.test.ts) as a characterization guard that fused ordering matches the pre-refactor output. Acceptance: existing search tests green; fusion now sourced from the shared helper (Q2).",
  "files": ["src/core/search.ts", "src/core/search.test.ts"],
  "depends_on": ["task-008"],
  "estimated_tokens": 4000,
  "complexity": "simple",
  "constraints": ["Q2"],
  "risk": "medium"
}

## Note
src/core/search.test.ts did not exist before this branch — net-new file, not an
extension of a pre-existing one. hybridSearchMemories() had zero prior dedicated
coverage in the repo. Not a scope violation.

## Reviewer verdict
{
  "verdict": "PASS",
  "task_id": "task-009",
  "issues": [],
  "summary": "hybridSearchMemories() correctly delegates fusion to rrfFuse([ftsNumIds, vecNumIds]) with the inlined RRF loop fully removed. String-ID <-> integer mapping is lossless. Public signature unchanged. hybridSearch() (atoms-side) untouched. Q2 satisfied. Characterization test pins fused ordering via computed RRF math."
}

## Meta
- timestamp: 2026-07-22T00:40:00Z
- model: sonnet (implementer), sonnet (reviewer)
- verification: `npx vitest run src/core/search.test.ts` -> 15 passed, 15 total (also verified jointly with recall.test.ts: 37/37).
---
