# Implementation Spec: VCC follow-ups (transcript_path exposure + parallel-file auto-compact)

## Implementation Approach

Two independent capabilities land on one branch, built as three parallel tracks that converge into a fourth:

- **Track A** — additive text-output change in the `nexus_sessions` formatter. No I/O, no schema change, no new DB read.
- **Track B** — one idempotent `ALTER TABLE` migration, following the repo's existing v10/v11 pattern byte-for-byte.
- **Track C** — a new file-write primitive in `vcc-bridge.ts`, built as two TDD increments: the success path first (already safe by construction, since `compactToParallelFile` has no destination parameter — no caller can express `jsonlPath` as a target), then the failure/safety path, which is where the hard ADR-015 constraint is proven by test rather than asserted by review.
- **Track D** — `reflector.ts` wiring, built last because it is the only component that depends on two other components' output (the migrated column, the new compactor function) and sits physically adjacent to the disabled `compactFileInPlace` block that must not move or be edited.

Every track is a strict red → green TDD pair: a test task that must fail against current source, followed by an implementation task sized to make exactly that test pass and nothing more. No implementation task adds behavior beyond what its preceding test task exercises.

The safety guarantee (design Goal 3) is not a single check — it is structural first (no destination parameter exists, so no code path, including a forced-failure test, can reach `jsonlPath` as a rename target), then belt-and-braced with an internal `assertNotSource` tripwire, then proven twice: once in `vcc-bridge.test.ts` via a `renameSync` spy, and once in `reflector.test.ts` at the DB level (`vcc_shrunk_path` stays `NULL` on a forced failure).

`core/types.ts` is intentionally out of scope and touched by no task: it is outside the design's scope ceiling, `Session.jsonl_path` already exists, and `vcc_shrunk_path` is written and read only through raw SQL (`UPDATE sessions SET vcc_shrunk_path = ...`) that is never destructured through a TS-typed `Session` object in this change.

## Build Order and Dependencies

Three tracks start in parallel — no shared files, no logical coupling:

- **Track A** (`src/mcp/server.ts`): task-001 → task-002
- **Track B** (`src/core/database.ts`): task-003 → task-004
- **Track C** (`src/capture/vcc-bridge.ts`): task-005 → task-006 → task-007 → task-008

**Track D** (`src/capture/reflector.ts`) starts only once both B and C finish, since its trigger needs the `vcc_shrunk_path` column (Track B) and `compactToParallelFile` (Track C) to exist:

- task-009 (depends on task-004, task-008) → task-010

Track A has zero dependency on B/C/D and can merge independently at any point — it is the lowest-risk, most isolated slice and a good first PR if the tracks are landed sequentially rather than in parallel.

## Test Strategy per Component

- **SessionListFormatter** (`mcp/server.ts`) — unit only. The change is a pure formatting addition over data already in hand (`listSessions()` already does `SELECT *`). A string-output assertion on the tool handler is sufficient; there is no new I/O or new DB read to integration-test.
- **SessionsMigrationV12** (`database.ts`) — unit only, mirroring the existing v10 test exactly: schema introspection after running migrations, plus idempotency-on-rerun. Migrations in this repo are already tested at this level; no reason to diverge.
- **ParallelCompactor / CompactTargetGuard** (`vcc-bridge.ts`) — unit, with the CLI boundary (`spawnSync`) mocked rather than exercised via a real CLI binary or a real filesystem permission failure. Rationale (from architecture): permission-based failure is unreliable on Windows (this repo's primary platform) and would test the OS, not the invariant; mocking one level below `runCli` exercises real error-handling code instead of stubbing it away. This is the one component where the test *is* the deliverable as much as the code — the `renameSync` spy is what turns "we believe this is safe" into "we can show this is safe," per the design's explicit demand for a regression test over review.
- **ReflectCompactTrigger** (`reflector.ts`) — unit, using a mocked `compactToParallelFile` (Track C already proves the real CLI boundary at its own level — no need to re-exercise it here) plus a real/in-memory sqlite instance for the `UPDATE` assertion, consistent with how this file already tests `vcc_shrunk_at`. No end-to-end test spawns the real VCC CLI — that would make the suite slow and flaky while duplicating what Track C already proves.
- No component in this change warrants zero coverage: all four touch either a tool's output contract, a migration, a data-loss-capable file operation, or the wiring between them.

## Edge Cases and Error Handling per Component

### SessionListFormatter

- `jsonl_path` null or empty string → emit the literal `transcript_path: (none)`, never omit the key. Keeps the line shape stable for any consumer or test doing positional or key-presence parsing.

### SessionsMigrationV12

- Rerun on an already-migrated DB → `ALTER TABLE` throws "duplicate column name", caught and swallowed, exactly like v10/v11.
- Do not special-case detection via `PRAGMA table_info` before attempting the `ALTER` — would diverge from the established pattern for no benefit.

### ParallelCompactor

- CLI non-zero exit → best-effort unlink the temp file inside its own try/catch (so an unlink failure can't mask the original CLI error) → return `{ ok: false, error }`, no `path`.
- CLI throws or times out → same handling as above.
- `assertNotSource` trips → should be unreachable given no destination parameter exists on the public function, but is the belt-and-braces tripwire; caught by the same outer try/catch → `{ ok: false }`.
- Success → exactly one `renameSync` call, target is always `parallelShrunkPath(jsonlPath)`, never a caller-supplied or CLI-supplied value.

### ReflectCompactTrigger

- `rawLines` empty → skip, no call.
- `opts.transcript_path` falsy → skip, no call (nothing to compact if the session has no known transcript path).
- Window size at or under `VCC_PARALLEL_COMPACT_BYTES` → skip, no call.
- `compactToParallelFile` throws synchronously despite its own internal try/catch (defense in depth) → the trigger's own outer try/catch still catches it, `console.error`, no `UPDATE`, `reflect()` returns its normal result.
- The `UPDATE` itself throws (e.g. locked DB) → caught by the same try/catch, `console.error`, `vcc_shrunk_path` stays at whatever value it already had. This is a deliberate distinction from "always ends up NULL": a failed *re*-compaction must not erase a previously valid shrunk-copy pointer from an earlier successful run. Fail-open means "leave the column alone," not "reset it."
