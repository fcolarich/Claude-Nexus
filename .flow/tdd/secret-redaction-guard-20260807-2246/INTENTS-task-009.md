# task-009 — Write high-entropy backstop tests (red)

**Status:** PASS
**Timestamp:** 2026-08-08T00:15:00Z
**Implementer model:** claude-sonnet-4-6
**Reviewer:** flow-shared:tdd-reviewer (fast-path, risk=low), 1 attempt

## Files changed

- `src/capture/secrets.test.ts` (extended)
- `src/capture/secrets.fixtures.ts` (extended — added short_opaque_token_23_char)

## Review notes

Implementer deviated from the task description's literal "api_key=" cue example,
using "auth:" instead — correct call, since "api_key=" is in assigned_secret's
keyword group (runs earlier in table order) and would misclassify before ever
reaching the high_entropy heuristic. Confirmed sound against architecture.md's
cue regex and the task-001 precedent (same collision class). Reviewer flagged
this as a nit against the task spec wording, not the implementation.

## Verdict

PASS. Legitimate RED — 1 failing (high_entropy positive case), 39 passing.
