# task-001 — Add origin.test.ts coverage for non-project-cwd exclusion (red)

**Status:** PASS | **Timestamp:** 2026-08-08T15:35:00Z
**Reviewer:** flow-shared:tdd-reviewer (fast-path, risk=low)

Files: `src/capture/origin.test.ts` (extended). 4 new cases (home-dir,
drive/POSIX-root, real-project regression, fail-open) + existing tests
adapted to the new `cwd` positional param. `vi.mock('os', ...)` approach
confirmed sound for ESM interception. Legitimate RED — classifyOrigin
doesn't accept cwd yet.
