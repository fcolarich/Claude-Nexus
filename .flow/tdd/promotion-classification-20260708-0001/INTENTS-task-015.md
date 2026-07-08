---
# INTENTS: task-015 — Acceptance validation — full suite green + backward-compat checks

## Task
```json
{"id": "task-015", "files": [], "depends_on": ["task-013","task-010"], "risk": "low"}
```

## Validation result

`npm test`: **21 test files, 176/176 tests passing.** `npx tsc --noEmit`: clean, zero errors.

Baseline was 143 tests pre-feature; 33 new tests added across extract.test.ts (+8... actually 25 total in file, 2 new specifically for task-005 on top of task-004's 8), database.test.ts (+5), memories.test.ts (+1 net new test), server.test.ts (+17 new file). Net: 176 - 143 = 33 new passing tests, 0 regressions.

### Acceptance criteria verification
- **AC-1** (unformalized decision -> promotion_target='ddr'|'adr', listed by nexus_promotions): SYSTEM_PROMPT classification block verified verbatim (task-003 review); nexus_promotions query/grouping verified against D-004 spec (task-011 review). Model-behavior precision itself is NOT suite-automatable — flagged as a MANUAL end-to-end check per the task brief (run one real session, observe classification precision, tighten "be conservative" prompt rules if over-flagging). Not blocking this gate.
- **AC-2** (restating ADR-051 -> reference memory, promotion_target='none'): covered by task-005's refineCandidates force-none tests (PASS, 25/25 in extract.test.ts).
- **AC-3** (nexus_mark_promoted(id,'ADR-063') -> body ends '→ ADR-063'): covered by task-013's server.test.ts tests, explicitly asserting body ends with the artifact ref pattern (PASS, 17/17).
- **AC-4** (all ~107 existing tests pass): exceeded — 176/176 passing, includes the original baseline (143 tests were already passing before this feature branch per the Level-0 checkpoint) plus 33 new.
- **AC-5** (old extraction JSON without promotion_target parses as 'none'): covered by task-004's parseCandidates missing-field test (PASS).
- **AC-6** (migration idempotent on re-open): covered by task-007's idempotency test calling initializeSchema twice (PASS).

### Deviations from plan
1. task-010's `files` scope in tasks.json (reflector.ts, reflector.test.ts only) was too narrow versus impl-spec.md's explicit fallout instruction; widened at dispatch time to cover 11 files (backfill.test.ts, export.test.ts, project-migrate.test.ts, prune.test.ts, distill.ts, distill.test.ts, lifecycle.test.ts, recall.test.ts, integration.test.ts added). One additional file (decay.test.ts) was missed by that dispatch and fixed directly by the orchestrator with the same one-line fixture pattern.
2. Two pre-existing server.ts call sites (nexus_remember, nexus_remember_batch) needed `promotion_target: 'none'` added to compile after task-008 made the field required — no task explicitly owned this; fixed directly by the orchestrator (non-controversial, same fixture-fallout pattern as task-010).
3. architecture.md specifies two features NOT in the approved spec (docs/Claude Nexus - Promotion Classification Spec.md) and NOT in tasks.json: an `upgradePromotionTarget()` dedup-merge helper, and `content_hash` recomputation in `nexus_mark_promoted`. Per "spec wins on conflict," neither was implemented — tasks.json/impl-spec.md already correctly excluded both, and the orchestrator confirmed this was intentional rather than an oversight before dispatching tasks 010 and 012.
4. task-013's first draft had 2 failing tests due to a foreign-key constraint violation (superseded_by referencing a non-existent placeholder id); fixed directly by the orchestrator by inserting a real second memory row as the target.
5. Gemini second review for task-012 (risk=high) was unavailable in this environment (model access error) — logged as a non-blocking gap; proceeded on Sonnet's full-checklist PASS per the routing rules' tolerance for Gemini being supplementary.
6. task-014 (dashboard filter chip) was skipped per explicit pre-authorization — optional, affects no acceptance criterion.

## Meta
- timestamp: 2026-07-08T01:10:00Z
- Full suite: 176/176 passing, 0 failing
- tsc: clean
---
