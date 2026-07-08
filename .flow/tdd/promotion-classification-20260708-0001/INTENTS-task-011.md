---
# INTENTS: task-011 — Add nexus_promotions MCP tool (read-only listing, grouped by target)

## Task
```json
{"id": "task-011", "files": ["src/mcp/server.ts"], "depends_on": ["task-008"], "risk": "medium", "constraints": ["D-003","D-004","D-008"]}
```

## Reviewer verdict
```json
{"verdict":"PASS","task_id":"task-011","issues":[],"summary":"nexus_promotions implementation correct. Params schema matches spec exactly. SQL WHERE clause matches D-004 verbatim including all four conditions. Optional project/target filters appended correctly. ORDER BY matches spec. Project resolution mirrors other tools. Empty case returns exact required string. D-003 shape compliant. No writes anywhere — D-008 satisfied."}
```

## Meta
- timestamp: 2026-07-08T00:47:00Z
- model: sonnet (implementer), sonnet (reviewer)
- Known pre-existing (not this task's) compile errors remain at server.ts:358 and :428 (nexus_remember/nexus_remember_batch) — deferred to task-012 dispatch.
---
