# task-007 — Write full-mode pattern tests (red)

**Status:** PASS
**Timestamp:** 2026-08-08T00:06:00Z
**Implementer model:** claude-sonnet-4-6
**Reviewer:** flow-shared:tdd-reviewer (fast-path, risk=low), 1 attempt

## Files changed

- `src/capture/secrets.test.ts` (extended)
- `src/capture/secrets.fixtures.ts` (extended — added bearer_header sample)

## Verdict

PASS. Legitimate RED — 6 failing (jwt, connection_string_password,
assigned_secret, bearer_header full-mode + group-semantics cases), 20
passing (everything else unaffected).
