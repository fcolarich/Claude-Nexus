# task-008 — Implement full-mode rows with capture-group span replacement (green)

**Status:** PASS
**Timestamp:** 2026-08-08T00:22:00Z
**Implementer model:** claude-sonnet-4-6
**Reviewer:** flow-shared:tdd-reviewer (full checklist, risk=high), 2 attempts, then
flow-spec-test-driven-development:tdd-reviewer-gemini PASS (0 issues)

## Files changed

- `src/capture/secrets.ts` (extended)

## Review history

- Attempt 1: NEEDS_REVISION — blocker: assigned_secret keyword alternation
  omitted credential, access[_-]?key, private[_-]?key, client[_-]?secret,
  passphrase (all required by architecture.md). Warnings: bearer_header
  charset missing ~+/= and no {16,} minimum; assigned_secret value group had
  no {8,} minimum. Nit: JWT segment minimum {5,} vs spec's {10,}.
- Fix applied: all four addressed, verified against architecture.md exactly.
- Attempt 2: PASS. Gemini PASS with zero issues (checked ReDoS risk,
  match.indices offset correctness, strict/full-mode interaction, null
  handling — all clean).

## Verdict

PASS (both reviewers). 39/40 secrets.test.ts tests passing — sole failure
is task-010's high_entropy scope, unaffected.
