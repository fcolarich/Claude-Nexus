# task-016 — Implement redactCandidate with injectable redactor (green)

**Status:** PASS
**Timestamp:** 2026-08-08T01:50:00Z
**Reviewer:** flow-shared:tdd-reviewer (full checklist, risk=high) PASS, then
flow-spec-test-driven-development:tdd-reviewer-gemini PASS (0 issues)

## Files changed

- `src/capture/secrets.ts` (extended: redactCandidate, MemoryCandidateLike)

## Verdict

PASS (both reviewers). 50/50 secrets.test.ts tests green. D-011 confirmed
(zero project imports, structural typing used instead of importing
MemoryCandidate). task-022 (gate-2 wiring) now unblocked.
