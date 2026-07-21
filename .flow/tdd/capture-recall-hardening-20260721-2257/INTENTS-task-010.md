---
# INTENTS: task-010 — Fuse FTS5+vector in recallByQuery

## Task
{
  "id": "task-010",
  "title": "Fuse FTS5+vector in recallByQuery",
  "description": "TDD: extend recall.test.ts with the SC-5 case — a keyword-exact FTS5 match that a stronger cosine match currently suppresses appears in the fused top-N after the change; plus assertions that excludeIds are dropped, the minSimilarity floor does NOT re-suppress FTS5-exact hits, and the reranker runs over the fused set. Then rework recallByQuery() in src/core/recall.ts: vector pool limit*6, FTS5 pool limit*3, fuse via rrfFuse([ftsIds, vecIds]), drop excludeIds, apply the minSimilarity floor to vector-originated candidates only (FTS5-exact ids bypass the floor so fusion is not undone), then rerank the bounded fused set (~top limit*3) when enabled, falling back to fused order if the reranker throws or is disabled. Preserve the estTokens budget walk. Acceptance: SC-5 passes; existing recall tests green.",
  "files": ["src/core/recall.ts", "src/core/recall.test.ts"],
  "depends_on": ["task-008"],
  "estimated_tokens": 6500,
  "complexity": "complex",
  "constraints": ["Q2", "Q3"],
  "risk": "medium"
}

## Correction applied
The implementer's first pass of the three non-reranker-focused SC-5 tests (fusion,
minSimilarity-floor, excludeIds) did not pass `rerankFn`. This repo's
extraction_models.yaml sets `reranker.enabled: true` (a real local override — the
code DEFAULT is still `false` pending task-012), so those tests unintentionally hit
the REAL local reranker HTTP daemon (src/core/reranker.ts -> 127.0.0.1:8931). Something
is listening on that port on this dev machine, so calls didn't hard-fail — the real
cross-encoder correctly filtered out the semantically-irrelevant fixture memories the
tests used to prove pure fusion behavior, making 2 of 3 tests fail nondeterministically.
Fixed by adding `rerankFn: async () => null` to those three tests (forces deterministic
fused-order fallback), with an explanatory comment. Only the rerankFn injection was
added — no assertion was weakened. The two reranker-interaction tests already had their
own explicit rerankFn/spy and were unaffected.

## Reviewer verdict
{
  "verdict": "PASS",
  "task_id": "task-010",
  "issues": [
    {
      "severity": "nit",
      "location": "src/core/recall.ts:239",
      "note": "Vector pool uses Math.max(limit*6, 30) rather than literal limit*6. Reasonable defensive extension for small limit values, undocumented in spec but not a correctness issue."
    }
  ],
  "summary": "Pool sizes, fusion order, excludeIds drop, minSimilarity floor bypass for FTS5-matched ids, bounded reranker with fallback, and estTokens budget walk preservation all verified correct against spec. useReranker condition does not weaken the production gate for real callers (reduces to rerankerCfg.enabled when no rerankFn supplied). rerankFn-isolation test fix is determinism hygiene only, no assertions weakened."
}

## Meta
- timestamp: 2026-07-22T00:40:00Z
- model: sonnet (implementer), sonnet (reviewer)
- verification: `npx vitest run src/core/recall.test.ts src/core/search.test.ts` -> 37 passed, 37 total (recall.test.ts alone: 22/22).
---
