# task-006 — Implement strict SECRET_PATTERNS rows and redactSecrets core loop (green)

**Status:** PASS
**Timestamp:** 2026-08-08T00:05:00Z
**Implementer model:** claude-sonnet-4-6
**Reviewer:** flow-shared:tdd-reviewer (full checklist, risk=high) PASS, then
flow-spec-test-driven-development:tdd-reviewer-gemini PASS (2 nits:
theoretical ReDoS edge case on private_key_block delimiters, undocumented
placeholder-non-collision assumption — both accepted as-is, low practical
risk)

## Files changed

- `src/capture/secrets.ts` (extended)

## Verdict

PASS (both reviewers). 11 strict rows in correct table order, chained
replace passes, no shared-regex lastIndex hazard, entry guard correct.
20/26 tests passing — the 6 failures are task-007's full-mode tests,
confirmed out of scope for this task.
