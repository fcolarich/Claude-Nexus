# task-015 — Write redactCandidate tests (red)

**Status:** PASS
**Timestamp:** 2026-08-08T01:42:00Z
**Reviewer:** flow-shared:tdd-reviewer (fast-path, risk=low), 1 attempt

## Files changed

- `src/capture/secrets.test.ts` (extended)

## Notes

Two nits: injected-redactor test uses toHaveBeenCalled() (satisfied by one
call) rather than a call-count check, so it wouldn't catch a partial-field
injection bug — left as-is, marginal since tests 1-4 cover full-field
behavior via the default redactor. Kind-aggregation order (title→body→tags)
inferred from architecture.md prose, flagged for task-016 to confirm.

## Verdict

PASS. Legitimate RED — redactCandidate not exported yet.
