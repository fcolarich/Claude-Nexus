# task-010 — Implement the high_entropy heuristic (green)

**Status:** PASS
**Timestamp:** 2026-08-08T01:19:00Z
**Implementer model:** claude-sonnet-4-6
**Reviewer:** flow-shared:tdd-reviewer (full checklist, risk=high) PASS (1 nit:
dead-code length check), then flow-spec-test-driven-development:tdd-reviewer-gemini
NEEDS_REVISION (blocker: shannonEntropy used token.length instead of code-point
count, mismatched for surrogate-pair input) — orchestrator verified unreachable
via the ASCII-only candidate regex but fixed anyway per user's "fix first"
decision, since it's a real latent bug in the exported function.

## Files changed

- `src/capture/secrets.ts` (extended: high_entropy heuristic, out-of-scope
  placeholder-guard fix in replaceGroupSpan, shannonEntropy code-point fix)

## Verdict

PASS (both reviewers, after fix). 44/44 secrets.test.ts tests green.
