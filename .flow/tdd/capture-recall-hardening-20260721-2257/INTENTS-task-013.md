---
# INTENTS: task-013 — Full-suite green integration gate

## Task
{
  "id": "task-013",
  "title": "Full-suite green integration gate",
  "description": "Final integration gate: run the full Vitest suite on feature/capture-recall-hardening (recall, search, export, extract, rrf, config) and confirm all green with the new per-item tests present and no assertions weakened. Fix any cross-item regression surfaced, especially the RRF-fusion × reranker-default interaction. Acceptance: SC-7 — all five items shipped on one branch, suites green, new tests added per item rather than modified to weaken assertions.",
  "files": ["src/core/recall.test.ts", "src/core/search.test.ts", "src/capture/export.test.ts", "src/capture/extract.test.ts", "src/core/rrf.test.ts", "src/core/config.test.ts"],
  "depends_on": ["task-012", "task-009"],
  "estimated_tokens": 2500,
  "complexity": "simple",
  "constraints": [],
  "risk": "low"
}

## Cross-item regression found and fixed
Full suite run (no filter) initially showed 23/24 files passing, 1 failure:
`src/capture/backfill.test.ts > runs the Reflector over selected past sessions`
timed out at 5000ms (took 11.8s), but passed in 41ms when run in isolation.

Root cause: this dev machine runs a real local-reranker HTTP daemon
(extraction_models.yaml has reranker.enabled: true; DEFAULTS.reranker.enabled is
now also true per task-012). Three pre-existing recallByQuery() calls in
recall.test.ts's `describe('recallByQuery', ...)` block don't pass an explicit
rerankFn, so they hit the real network daemon. Under the full suite's parallel
worker execution, this created enough contention to blow an unrelated test's
default timeout in backfill.test.ts.

Fix: added `vi.mock('./reranker.js', () => ({ rerank: vi.fn().mockResolvedValue(null) }))`
to the top of recall.test.ts, alongside the existing embeddings.js/gpt-tokenizer
mocks. Defaults every recallByQuery() call in the file to "reranker unavailable"
unless a test explicitly injects its own rerankFn via opts (which bypasses the
module mock entirely — doRerank = opts.rerankFn ?? rerankDocuments). This also
fixes a latent test-hygiene issue: those three tests only worked before because
this specific dev machine happens to run the daemon; they'd have been silently
skipping the rerank path (or failing/hanging) on any machine without it.

Result: full suite now 24 files / 216 tests / 0 failures / 2.12s (down from
16.56s with the timeout).

## Reviewer verdict
{
  "verdict": "PASS",
  "task_id": "task-013",
  "issues": [],
  "summary": "vi.mock('./reranker.js', ...) is file-scoped, doesn't leak. Bypass path confirmed via doRerank = opts.rerankFn ?? rerankDocuments — all reranker-interaction tests (SC-5, 'recallByQuery reranking') supply explicit rerankFn and are unaffected. No assertion weakened anywhere. SC-7 confirmed: all six files carry substantive new tests from their respective prior tasks. Suite: 24 files / 216 tests / 0 failures."
}

## Meta
- timestamp: 2026-07-22T01:02:00Z
- model: orchestrator (gate execution + fix), sonnet (reviewer)
- verification: `npx vitest run` -> 24 test files passed, 216 tests passed, 0 failed.
---
