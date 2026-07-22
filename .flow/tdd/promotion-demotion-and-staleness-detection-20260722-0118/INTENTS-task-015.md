---
# INTENTS: task-015 — End-to-end integration test for consolidateMemories (all five phases)

## Task
{
  "id": "task-015",
  "title": "End-to-end integration test for consolidateMemories (all five phases)",
  "files": ["src/core/consolidate.test.ts", "src/core/consolidate.ts", "src/core/governance.ts", "src/core/database.ts"],
  "depends_on": ["task-013"],
  "risk": "low"
}

## Reviewer verdict
{
  "verdict": "PASS",
  "summary": "3 comprehensive tests: full phase-order/aggregate-outcome test (all 5 phases, concrete side-effect assertions beyond just counts), self-heal test (raw DELETE simulating decay.ts's wipe, throwing haikuFn proves no re-shortlisting), schema-drift test (column snapshot + CHECK value presence). No blockers."
}

## Follow-up hardening (post-review, self-applied)
Reviewer flagged a non-blocking nit: the schema-drift test's CHECK-value assertions used
`toContain`, which would catch a removed value but not a newly ADDED one, contradicting the
test's own comment claiming exclusivity. Tightened to extract the CHECK(...) clause's value
list precisely (scoped regex on the CHECK(column IN (...)) substring, not the whole CREATE
TABLE SQL — the naive whole-SQL regex would have picked up unrelated quoted strings like
`datetime('now')`) and assert exact set equality (sorted) against the known value lists for
both memory_links.link_type and diagnostics.type. Re-ran full suite after the fix: still
209/209 passing project-wide.

## Meta
- timestamp: 2026-07-22T01:55:00Z
- model: sonnet (implementer), sonnet (reviewer)
---
