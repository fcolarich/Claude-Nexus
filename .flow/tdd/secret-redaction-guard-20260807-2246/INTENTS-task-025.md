# task-025 — Write reflector fail-open tests with a throwing deps.redact double (red)

**Status:** PASS | **Timestamp:** 2026-08-08T12:05:00Z
**Reviewer:** flow-shared:tdd-reviewer (fast-path, risk=low)

Files: `src/capture/reflector.test.ts` (extended). Both tests passed
immediately (fail-open already implemented by task-020/022) — confirmed as
meaningful regression guards, not trivially-passing assertions.
