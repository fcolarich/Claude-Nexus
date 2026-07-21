---
# INTENTS: task-011 — Latency spot-check of fused-set rerank

## Task
{
  "id": "task-011",
  "title": "Latency spot-check of fused-set rerank",
  "description": "Latency spot-check (not a benchmark harness): measure recallByQuery's reranker pass over the fused candidate set at per-prompt call frequency and confirm it holds within the 50–100ms envelope. Record the observed figure and the validation as a comment at the rerank call site in src/core/recall.ts. If it exceeds the envelope, tighten the bounded fused-set rerank input cap (Q3) in recall.ts until it fits and note the final cap. Acceptance: part of SC-6 — observed per-prompt fused-set rerank latency recorded and within envelope; gates task-012.",
  "files": ["src/core/recall.ts"],
  "depends_on": ["task-010"],
  "estimated_tokens": 3000,
  "complexity": "simple",
  "constraints": ["Q3"],
  "risk": "low"
}

## What was measured
Real local reranker daemon at 127.0.0.1:8931 (jina-reranker-v2-base-multilingual),
already live on this dev machine. Orchestrator measured wall-clock latency directly
(implementer subagent had no shell access, left a TODO). Sweep (warm calls, post
warmup):
  N=1: ~31ms, N=3: ~72ms, N=4: ~96ms (one outlier 114ms), N=5: ~110ms,
  N=8: ~169ms, N=10: ~232ms, N=15: ~348ms.
Original `limit*3` bound at default limit=5 = 15 candidates = ~350ms, over 3x the
100ms ceiling. Fix: rather than shrinking the whole candidate pool (which would
also shrink the non-reranked fallback below `limit`), only the reranker's network
INPUT is capped at `RERANK_INPUT_CAP = 3`. The uncapped `bounded = hydrated.slice(0,
limit*3)` pool is preserved; `rerankHead` (first 3) goes to the network call,
`rerankTail` (rest, in RRF-fused order) is reattached after the reranked head so a
full `limit`-sized result is still achievable when the reranker succeeds. Fallback
path (disabled/throws/empty) still maps the full `bounded` pool, unaffected.

## Reviewer verdict
{
  "verdict": "PASS",
  "task_id": "task-011",
  "issues": [],
  "summary": "Comment records the full latency sweep, explicitly states the envelope breach (~350ms vs 100ms ceiling), names the final cap (RERANK_INPUT_CAP=3, ~72ms). Bounded pool (limit*3) preserved; only rerankHead sent to network call. rerankTail correctly reattached, full limit-sized result set still achievable. Fallback maps entire bounded pool, no regression. No stray debug artifacts."
}

## Meta
- timestamp: 2026-07-22T00:50:00Z
- model: sonnet (implementer scaffold), orchestrator (actual measurement + fix), sonnet (reviewer)
- verification: `npx vitest run src/core/recall.test.ts src/core/search.test.ts` -> 37 passed, 37 total.
---
