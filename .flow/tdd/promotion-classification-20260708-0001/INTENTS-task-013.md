---
# INTENTS: task-013 — MCP tool tests for nexus_promotions and nexus_mark_promoted

## Task
```json
{"id": "task-013", "files": ["src/mcp/server.test.ts"], "depends_on": ["task-011","task-012"], "risk": "medium", "constraints": ["D-003","D-004","D-005","D-006"]}
```

## Implementation note
New file. Approach A taken: extracted/mirrored the exact query and body-rewrite logic from server.ts's nexus_promotions/nexus_mark_promoted as standalone test helpers against a `:memory:` DB, rather than importing server.ts directly (which has module-level side effects — opens a real DB, starts a stdio server). Matches existing precedent (memories.test.ts testing rememberBatch logic as a stand-in for nexus_remember_batch).

Orchestrator found and fixed 2 failing tests in the implementer's first draft: both set `superseded_by` to a non-existent placeholder id ('some-other-id' / 'other'), which violated a foreign-key constraint on that column. Fixed by inserting a real second memory row and using its actual id as the superseded_by value — preserves test intent (proving a superseded memory is excluded from nexus_promotions results) without weakening the assertion.

## Reviewer verdict
```json
{"verdict":"PASS","task_id":"task-013","issues":[],"summary":"Test logic is a faithful mirror of server.ts — queryPromotionCandidates replicates nexus_promotions SQL verbatim, runMarkPromoted replicates nexus_mark_promoted verbatim. FK fix correct, preserves exclusion assertion. D-005 covered by 2 dedicated tests. D-006 covered by AC-3 body-rewrite test + idempotency test. No server.ts modifications, no scope violations, 17/17 tests meaningful."}
```

## Meta
- timestamp: 2026-07-08T01:05:00Z
- model: sonnet (implementer), sonnet (reviewer), orchestrator (FK bugfix)
- Full suite: 176/176 passing (159 + 17 new), tsc clean
---
