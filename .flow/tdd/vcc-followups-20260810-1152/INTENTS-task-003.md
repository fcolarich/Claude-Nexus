# task-003: Write failing test: migration v12 adds sessions.vcc_shrunk_path
Files: src/core/database.test.ts
Reviewer verdict: PASS after 1 revision (fast-path, risk: low)
Timestamp: 2026-08-10T10:49:45Z
Models: implementer=sonnet, reviewer=tdd-reviewer
Notes: fixed vacuous LIMIT 0 NULL-default assertion by inserting+reading back a real row.
