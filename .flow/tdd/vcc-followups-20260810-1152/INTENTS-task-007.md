# task-007: Write failing tests: compactToParallelFile failure/safety path (ADR-015 regression test)
Files: src/capture/vcc-bridge.test.ts
Reviewer verdict: PASS (fast-path, risk: low)
Timestamp: 2026-08-10T11:10:01Z
Models: implementer=sonnet, reviewer=tdd-reviewer
Notes: GREEN on first write, not RED - correct outcome since task-006 already engineered the safety invariant; this is a regression guard, not a TDD driver. Reviewer independently verified the renameSync guard is strict (path.resolve comparison) and would catch a real regression.
