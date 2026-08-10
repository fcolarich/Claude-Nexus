# task-008: Implement CompactTargetGuard (assertNotSource) and failure-path handling in compactToParallelFile
Files: src/capture/vcc-bridge.ts, src/capture/vcc-bridge.test.ts
Reviewer verdict: PASS after 1 additional test added (full checklist, risk: high)
Timestamp: 2026-08-10T14:39:37Z
Models: implementer=sonnet, reviewer=tdd-reviewer
Notes: first-pass review flagged that no test forced the assertNotSource tripwire itself to fire (all failure paths short-circuited before reaching it). Added a dedicated test mocking path.resolve to force the collision; reviewer confirmed on re-review this genuinely exercises the real tripwire logic, not a vacuous mock. Full ADR-015 safety invariant now has 4 tests: success, CLI non-zero exit, spawn throw, and tripwire collision.
Known pre-existing unrelated failure: reflector.test.ts "sets sessions.vcc_shrunk_at after a full reflect() pass" (targets compactFileInPlace, not this work) — confirmed pre-existing via git diff HEAD~1, present before this TDD session started. Track D (task-009/010) will touch reflector.ts next; verify this failure's status there.
