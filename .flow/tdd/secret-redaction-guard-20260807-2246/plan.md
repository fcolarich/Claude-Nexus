# Plan: Secret-redaction guard on the capture path (FEAT-001)

Branch: `feature/secret-redaction-guard`
Session: `secret-redaction-guard-20260807-2246`
Complexity routing: **complex** (security subsystem, dual gates, multi-file) — planned with Opus.

## Task Table

| ID | Title | Files | Depends On | Tokens |
|----|-------|-------|------------|--------|
| task-001 | Create secrets.fixtures.ts with SECRET_SAMPLES and BENIGN_SAMPLES | secrets.fixtures.ts | — | 3000 |
| task-002 | Add SECRET_WINDOW_TEXT condensed-window fixture | secrets.fixtures.ts | task-001 | 3000 |
| task-003 | Write shannonEntropy unit tests (red) | secrets.test.ts, secrets.fixtures.ts | task-001 | 3000 |
| task-004 | Create secrets.ts scaffold and shannonEntropy (green) | secrets.ts | task-003 | 3500 |
| task-005 | Write strict-mode pattern tests (red) | secrets.test.ts, secrets.fixtures.ts | task-003 | 4500 |
| task-006 | Implement strict SECRET_PATTERNS rows + redactSecrets core loop (green) | secrets.ts | task-004, task-005 | 7000 |
| task-007 | Write full-mode pattern tests (red) | secrets.test.ts, secrets.fixtures.ts | task-005 | 4500 |
| task-008 | Implement full-mode rows with capture-group span replacement (green) | secrets.ts | task-006, task-007 | 6500 |
| task-009 | Write high-entropy backstop tests incl. zero-false-positive bound (red) | secrets.test.ts, secrets.fixtures.ts | task-007 | 5000 |
| task-010 | Implement the high_entropy heuristic (green) | secrets.ts | task-008, task-009 | 6500 |
| task-011 | Write idempotence and purity tests (red) | secrets.test.ts, secrets.fixtures.ts | task-009 | 4000 |
| task-012 | Harden the placeholder guard for idempotence (green) | secrets.ts | task-010, task-011 | 4000 |
| task-013 | Write internal fail-open test for redactSecrets (red) | secrets.test.ts | task-011 | 3500 |
| task-014 | Add internal try/catch fail-open to redactSecrets (green) | secrets.ts | task-012, task-013 | 3000 |
| task-015 | Write redactCandidate tests (red) | secrets.test.ts, secrets.fixtures.ts | task-013 | 4500 |
| task-016 | Implement redactCandidate with injectable redactor (green) | secrets.ts | task-014, task-015 | 5000 |
| task-017 | Add surgical mixed secret-plus-insight test | secrets.test.ts, secrets.ts | task-015, task-016 | 3500 |
| task-018 | Add redaction type surface + safeRedact helper to reflector.ts | reflector.ts | task-006 | 6000 |
| task-019 | Write gate-1 pre-extraction tests (red) | reflector.test.ts, secrets.fixtures.ts | task-002, task-006 | 8000 |
| task-020 | Wire gate 1 into reflect() before extract() (green) | reflector.ts | task-018, task-019 | 6000 |
| task-021 | Write gate-2 post-extraction tests (red) | reflector.test.ts, secrets.fixtures.ts | task-019 | 8000 |
| task-022 | Wire gate 2 into reflect() before dedup/insert loop (green) | reflector.ts | task-020, task-021 | 6500 |
| task-023 | Write ReflectResult observability tests (red) | reflector.test.ts | task-021 | 7000 |
| task-024 | Populate redactions/redaction_kinds + summary log line (green) | reflector.ts | task-022, task-023 | 5000 |
| task-025 | Write reflector fail-open tests with throwing deps.redact double (red) | reflector.test.ts | task-023 | 7000 |
| task-026 | Wire gate-2 fail-open containment (green) | reflector.ts | task-024, task-025 | 5500 |
| task-027 | Run full capture suite, confirm no regression | reflector.test.ts, secrets.test.ts, reflector.ts | task-026 | 6000 |
| task-028 | Add file-map rows for new capture files | file-map.md | task-016 | 2500 |
| task-029 | Rebuild committed dist output | dist/capture/*.js | task-027 | 2000 |

**Total estimated tokens:** 143,500
**Batch split:** none (29 tasks, under 30-task threshold)

## Coverage Matrix (Acceptance Criteria → Tasks)

| AC | Covered by |
|----|------------|
| AC-1 no known-format/high-entropy secret reaches Haiku call or persisted memories/export | task-006, task-008, task-010, task-019, task-020, task-021, task-022 |
| AC-2 surgical — only matched span replaced, surrounding insight kept | task-006, task-008, task-017, task-021 |
| AC-3 guard fails open on its own internal errors | task-013, task-014, task-025, task-026 |
| AC-4 both gates pure, side-effect-free, testable in isolation | task-004, task-011, task-012, task-016 |
| AC-5 fixture window, every named format → zero verbatim leakage | task-002, task-019, task-020, task-021, task-022 |
| AC-6 benign high-entropy fixtures → zero redactions | task-001, task-009, task-010, task-019 |
| AC-7 mixed secret + durable insight redacted in place | task-017, task-021 |
| AC-8 forced internal error → reflect() completes unmodified, no exception escapes | task-025, task-026 |
| AC-9 existing reflector.test.ts passes unmodified except new redaction assertions | task-018, task-022, task-027 |

## Parallelization Notes

- task-002 and task-003 can run in parallel (fixtures vs. test file).
- The reflector track (task-018, task-019) starts once task-006 lands and can run alongside the remaining secrets.ts track (task-007–task-017).
- task-028 (file-map doc) can run any time after task-016; shares no files with anything else.

## Planner Judgment Calls

- Neither design.md nor architecture.md used D-### IDs. impl-spec.md opens with a constraint register: design.md's 3 `## Constraints` bullets numbered D-001..D-003, architecture.md's 9 `## Decisions` numbered D-004..D-012. Task `constraints` fields reference those IDs.
- `redactCandidate` gets an optional second parameter (`redact: typeof redactSecrets = redactSecrets`) so an injected throwing `deps.redact` double can reach both reflector gates — without it, gate 2's fail-open branch would be untestable, leaving AC-3/AC-8 half-covered.

---
**Checkpoint — PLAN**
- 29 tasks created, estimated total tokens: 143,500
- Key dependency chain: task-001 → task-003 → task-004 → task-005 → task-006 → task-008 → task-010 → task-012 → task-014 → task-016 → task-018 → task-020 → task-022 → task-024 → task-026 → task-027 → task-029
- No batch split (29 tasks, under 30-task threshold)
- Approve tasks before running /execute?
