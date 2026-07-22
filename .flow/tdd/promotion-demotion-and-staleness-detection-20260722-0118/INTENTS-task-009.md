---
# INTENTS: task-009 — Implement confirmed-contradiction writes (links + diagnostic) (GATED)

## Task
{
  "id": "task-009",
  "title": "Implement confirmed-contradiction writes (links + diagnostic) (GATED)",
  "files": ["src/core/governance.ts", "src/core/database.ts"],
  "depends_on": ["task-008"],
  "risk": "high"
}

## Reviewer verdict (Sonnet, full checklist)
{
  "verdict": "PASS",
  "summary": "Bidirectional INSERT OR IGNORE with swapped parameter order confirmed to persist 2 distinct rows under UNIQUE(source_id,target_id,link_type). Diagnostic existence-guard correct (defense-in-depth; primary idempotency mechanism is the shortlist's own NOT EXISTS exclusion). contradictionsFlagged semantics consistent with the test. Surfacing-only, no schema changes, parameterized SQL.",
  "nit": "Existence-guard does a full-table scan over stale diagnostics per confirmed pair — acceptable at MAX_PAIRS_PER_RUN=20 scale, not a correctness issue."
}

## Gemini second opinion
Unavailable both attempts (model access error, google/gemini-2.5-flash). Treated as SKIP
per routing protocol. Manually addressed the concurrency/atomicity concern a second
reviewer would likely raise: the two directional memory_links inserts and the diagnostic
insert were NOT originally wrapped in a transaction, so a mid-write crash could leave one
direction persisted without the other — and since the shortlist's bidirectional NOT EXISTS
excludes a pair once EITHER direction exists, the missing direction would never be
backfilled on a future run (permanent asymmetry). Hardened by wrapping all three writes
(both directional links + the existence-guarded diagnostic) in a single `db.transaction()`
so they commit atomically. Re-ran the full suite after the change: 27/27 pass (18
contradiction tests + 9 help-rate tests), tsc clean.

## Meta
- timestamp: 2026-07-22T01:05:00Z
- model: sonnet (implementer), sonnet (reviewer), gemini (unavailable/skip, manually mitigated)
---
