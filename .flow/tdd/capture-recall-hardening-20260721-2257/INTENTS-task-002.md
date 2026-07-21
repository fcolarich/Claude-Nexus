---
# INTENTS: task-002 — Swap estTokens to BPE with heuristic fallback

## Task
{
  "id": "task-002",
  "title": "Swap estTokens to BPE with heuristic fallback",
  "description": "TDD: extend recall.test.ts with cases asserting the new estTokens error margin vs real cl100k_base counts is meaningfully tighter than Math.ceil(s.length/4) on both code-snippet and prose bodies, plus a fallback case (encode throws -> chars/4). Then reimplement estTokens(s: string): number in recall.ts to encode() via gpt-tokenizer, memoized by string, wrapped in try/catch falling back to Math.ceil(s.length/4). Signature and callers unchanged; the single change covers both the full-body budget walk and the title-only elision walk. Acceptance: SC-1 test passes; existing recall.test.ts green.",
  "files": ["src/core/recall.ts", "src/core/recall.test.ts"],
  "depends_on": ["task-001"],
  "estimated_tokens": 3500,
  "complexity": "simple",
  "constraints": ["Q1"],
  "risk": "low"
}

## Reviewer verdict
{
  "verdict": "PASS",
  "task_id": "task-002",
  "issues": [],
  "summary": "estTokens signature unchanged, all callers untouched. encode() wrapped in try/catch with chars/4 fallback, never re-thrown, fallback result memoized. Memoization keyed by raw string via module-level Map. SC-1 meaningfully asserts tighter accuracy (heuristicErr > 0 plus bpe === actual). Fallback test uses random string to bypass memo, mocks encode to throw once, verifies return value and call. No existing assertions weakened; 17/17 tests pass."
}

## Meta
- timestamp: 2026-07-22T00:00:00Z
- model: sonnet (implementer), sonnet (reviewer)
- verification: `npx vitest run src/core/recall.test.ts` -> 17 passed, 17 total.
---
