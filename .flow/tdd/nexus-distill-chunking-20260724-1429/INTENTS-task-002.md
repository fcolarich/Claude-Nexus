---
# INTENTS: task-002 — Add buildEligibleQuery + countEligible scope-filter helpers with unit tests

## Task
{
  "id": "task-002",
  "title": "Add buildEligibleQuery + countEligible scope-filter helpers with unit tests",
  "description": "In src/core/distill.ts add internal (non-exported) buildEligibleQuery(scope, limit) -> {sql, params} and countEligible(db, scope) -> number over the scope filter defined in impl-spec: project slug, 'global', and 'all' variants; buildEligibleQuery appends LIMIT :limit, countEligible never does. Global and project scopes are disjoint (a project run excludes scope='global'). Add unit tests in src/core/distill.test.ts asserting the exact sql/params per scope and that countEligible's SQL has no LIMIT.",
  "files": ["src/core/distill.ts", "src/core/distill.test.ts", ".flow/tdd/nexus-distill-chunking-20260724-1429/impl-spec.md"],
  "depends_on": ["task-001"],
  "estimated_tokens": 9000,
  "complexity": "simple",
  "constraints": [],
  "risk": "low"
}

## Reviewer verdict (attempt 2, after 1 fix cycle)
Attempt 1: NEEDS_REVISION — project-scope filter did not exclude scope='global' rows, violating the spec's explicit disjointness requirement; a dependent test encoded the bug as expected behavior.
Attempt 2 (final): PASS — "Previously identified blocker is fixed. Both buildEligibleQuery and countEligible project branches now add `AND scope != 'global'`... All three dependent tests... updated consistently... No unrelated changes or regressions found."

## Meta
- timestamp: 2026-07-24T15:25:30Z
- model: sonnet (implementer), sonnet (reviewer)
- orchestrator verification: npx tsc --noEmit clean; npx vitest run src/core/distill.test.ts — 9/9 pass
- Deviation accepted: buildEligibleQuery/countEligible/ResolvedScope exported (not internal) — required for cross-file unit testing per impl-spec's own test-strategy requirement; marked test-only via comment.
---
