# task-005 — Write strict-mode pattern tests (red)

**Status:** PASS
**Timestamp:** 2026-08-07T23:37:00Z
**Implementer model:** claude-sonnet-4-6
**Reviewer:** flow-shared:tdd-reviewer (fast-path, risk=low), 1 attempt

## Files changed

- `src/capture/secrets.test.ts` (extended)

## Review notes

Nit (non-blocking): match-order test asserts `redactions` order but not `result.text`
for the two-secret case. Per-kind table test already covers text correctness
individually. Left as-is.

## Verdict

PASS. Legitimate RED — redactSecrets not yet exported. STRICT_KINDS matches
architecture.md's SECRET_PATTERNS table.
