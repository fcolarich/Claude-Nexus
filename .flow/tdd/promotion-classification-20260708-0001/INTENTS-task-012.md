---
# INTENTS: task-012 — Add nexus_mark_promoted MCP tool (set promoted_to, rewrite body to thin pointer, re-embed)

## Task
```json
{"id": "task-012", "files": ["src/mcp/server.ts"], "depends_on": ["task-008"], "risk": "high", "constraints": ["D-003","D-005","D-006","D-008"]}
```

## Reviewer verdict (Sonnet, full checklist)
```json
{"verdict":"PASS","task_id":"task-012","issues":[{"severity":"nit","location":"src/mcp/server.ts:769-771","note":"Empty-body edge case theoretically writes empty string; practically impossible since insertMemory requires body. Non-blocking."}],"summary":"All 10 spec checklist items verified. Not-found guard fires before any SQL write. Body rewrite regex/append logic byte-for-byte identical to refineCandidates(). UPDATE only sets body/promoted_to/updated_at. embedMemory called after UPDATE, best-effort via .catch. review_status never touched. Parameterized SQL confirmed. D-003/D-005/D-006/D-008 all satisfied."}
```

## Gemini second review (risk=high)
Unavailable in this environment — model access error ("google/gemini-2.5-flash" not accessible). Logged as non-blocking gap per execute-agent instructions (Gemini is a supplementary second opinion; proceeding on Sonnet's full-checklist PASS since Gemini could not run at all, not because it flagged issues).

## Scope note
content_hash is deliberately NOT recomputed in this UPDATE, diverging from architecture.md's decision section (which specified recomputing it). The approved spec (docs/Claude Nexus - Promotion Classification Spec.md §4) and the task-012 JSON description both omit any content_hash mention — per "spec wins on conflict," architecture.md's extra scope was not implemented, matching how the upgradePromotionTarget scope-creep (task-010 relevant) was also correctly excluded earlier in this pipeline.

## Meta
- timestamp: 2026-07-08T00:55:00Z
- model: sonnet (implementer), sonnet (reviewer)
- Full suite: 159/159 passing, tsc clean after this task
---
