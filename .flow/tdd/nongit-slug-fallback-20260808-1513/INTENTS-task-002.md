# task-002 — Implement non-project-cwd exclusion in classifyOrigin() (green)

**Status:** PASS | **Timestamp:** 2026-08-08T15:44:00Z
**Reviewer:** flow-shared:tdd-reviewer (full checklist, risk=high) PASS
(1 non-blocking warning), then Gemini PASS (0 issues, verified
cross-platform path handling and error-isolation separately)

Files: `src/capture/origin.ts` (extended). New signature
`classifyOrigin(transcriptPath, cwd, cfg, env?)`. 15/15 origin.test.ts
passing. Warning noted: purge-origin.mjs's arg order must be verified by
hand at task-004 since it's untyped JS.
