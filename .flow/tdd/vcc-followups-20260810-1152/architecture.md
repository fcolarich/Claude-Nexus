# Architecture: VCC follow-ups (transcript_path exposure + parallel-file auto-compact)

## Components

### SessionListFormatter (`src/mcp/server.ts`, `nexus_sessions` handler)

**Responsibility:** Formats already-loaded `Session` rows into the `nexus_sessions` tool text output, now including each row's `jsonl_path` as `transcript_path`.

**Interface:**

```ts
// Existing tool handler — no signature change, no new DB read.
// listSessions() already returns Session rows via SELECT *, so jsonl_path is in hand.
// Emitted line per session gains one field:
//   transcript_path: s.jsonl_path
// Emission rule: always emit the key. If jsonl_path is null/empty, emit the
// literal `transcript_path: (none)` so the shape is stable for consumers/tests.
```

### ParallelCompactor (`src/capture/vcc-bridge.ts`)

**Responsibility:** Produces a shrunk *sibling copy* of a transcript via the VCC CLI, structurally incapable of writing to or renaming over the source path.

**Interface:**

```ts
// New, additive. CompactResult itself is NOT modified (see Decisions).
export type ParallelCompactResult = CompactResult & { path?: string };

export const VCC_SHRUNK_SUFFIX = '.vcc-shrunk.jsonl';

// Derives the destination internally. There is deliberately NO destination
// parameter — callers cannot express "write to jsonlPath".
export function parallelShrunkPath(jsonlPath: string): string;
// returns `${jsonlPath}${VCC_SHRUNK_SUFFIX}`

export function compactToParallelFile(
  jsonlPath: string,
  opts?: { timeoutMs?: number }
): ParallelCompactResult;
// ok:true  -> { ok: true, path: parallelShrunkPath(jsonlPath), ... }
// ok:false -> { ok: false, error, path: undefined }; temp file unlinked; no sibling left behind.
```

### CompactTargetGuard (`src/capture/vcc-bridge.ts`, internal to ParallelCompactor)

**Responsibility:** Enforces the ADR-015 hard invariant that no write or rename target ever resolves to the source transcript.

**Interface:**

```ts
// Internal, not exported from the module's public surface.
// Called immediately before the single renameSync, after the CLI returns.
function assertNotSource(target: string, jsonlPath: string): void;
// Throws (caught by compactToParallelFile's own try/catch -> ok:false) when
// path.resolve(target) === path.resolve(jsonlPath).
// Belt-and-braces: the invariant can only fire if parallelShrunkPath is broken,
// because no caller-supplied value ever reaches the rename.
```

### SessionsMigrationV12 (`src/core/database.ts`)

**Responsibility:** Adds the nullable `sessions.vcc_shrunk_path` column, idempotently, under the existing numbered-migration pattern.

**Interface:**

```ts
function migrateVccShrunkPath(db: Database): void;
// ALTER TABLE sessions ADD COLUMN vcc_shrunk_path TEXT
// try/catch swallow on "duplicate column name", exactly as migrateVccShrunkAt (v10)
// and migrateDistillCursor (v11). Registered as schema_version 12, name 'vcc-shrunk-path'.
```

### ReflectCompactTrigger (`src/capture/reflector.ts`, tail of `reflect()`)

**Responsibility:** Decides, once per `reflect()` invocation, whether the unprocessed window was large enough to warrant a parallel compaction, and records the resulting path.

**Interface:**

```ts
export const VCC_PARALLEL_COMPACT_BYTES = 200_000; // exported so tests carry no magic numbers
const VCC_PARALLEL_COMPACT_TIMEOUT_MS = 15_000;

// Inlined at the end of reflect(); no new exported function.
// Guarded by its own try/catch. Never throws, never aborts reflect().
```

---

## Data Flow

### Operation: MCP client calls `nexus_sessions`

1. `nexus_sessions` handler receives the tool call (unchanged args).
2. Handler calls `listSessions()` — unchanged `SELECT *`, zero new DB reads.
3. `listSessions()` returns `Session[]`, each already carrying `jsonl_path`.
4. SessionListFormatter emits one line per session including `transcript_path: <jsonl_path | (none)>`.
5. Handler returns the text block to the MCP client.

### Operation: `reflect()` run with an oversized unprocessed window

1. `reflect()` runs its existing pipeline unchanged: read new transcript lines, build `window`, pre-extraction `compactWindowLines`, extraction, dedup-merge, persist memories, redaction logging, `advanceCursor`.
2. ReflectCompactTrigger runs **last** — after `advanceCursor` has committed and after the disabled `compactFileInPlace` block, which is left byte-for-byte untouched.
3. Trigger computes `Buffer.byteLength(window.rawLines.join('\n'), 'utf-8')` from the window already in memory (no re-read).
4. If size `<= VCC_PARALLEL_COMPACT_BYTES`, or `rawLines` is empty, or `opts.transcript_path` is falsy, the trigger returns and `vcc_shrunk_path` is untouched.
5. Otherwise trigger calls `compactToParallelFile(opts.transcript_path, { timeoutMs: 15_000 })`.
6. ParallelCompactor invokes the VCC CLI via the same `runCli`/temp-file flow as `compactFileInPlace`, writing CLI output to a temp file in the source's directory.
7. CompactTargetGuard checks the derived destination, then `renameSync(temp, parallelShrunkPath(jsonlPath))`.
8. Trigger receives `{ ok: true, path }` and runs `UPDATE sessions SET vcc_shrunk_path = ? WHERE session_id = ?`.
9. `reflect()` returns its existing result unchanged.

### Operation: VCC CLI fails during parallel compaction

1. Steps 1-6 as above; `runCli` returns non-zero, times out, or throws.
2. ParallelCompactor unlinks the temp file (best-effort, inside its own try/catch) and returns `{ ok: false, error }` with no `path`.
3. No `renameSync` is invoked at all; the source transcript is byte-identical to before; no `.vcc-shrunk.jsonl` exists.
4. Trigger `console.error`s the failure and performs **no** `UPDATE` — `vcc_shrunk_path` stays NULL (fail-open, mirroring `vcc_shrunk_at`).
5. `reflect()` completes normally and returns its existing result.

---

## Storage

### `sessions` table (migration v12, `vcc-shrunk-path`)

```text
vcc_shrunk_path: TEXT NULL   # absolute path of the latest parallel shrunk copy; NULL until a
                             # successful compaction. Never written on failure. Overwritten on
                             # each subsequent success (path is deterministic, so value is stable).
```

### Parallel shrunk file (on disk)

```text
<jsonlPath>.vcc-shrunk.jsonl   # sibling of the source transcript, same directory
                               # format: whatever the VCC CLI emits (JSONL); not parsed by nexus
                               # lifecycle: replaced atomically by renameSync; never read back
                               # by the capture pipeline in this change
```

---

## Decisions

### Extend `nexus_sessions` rather than add `nexus_get_session`

**Decision:** Add `transcript_path` to the existing `nexus_sessions` output line.

**Alternatives:** New `nexus_get_session(session_id)` MCP tool; a separate resource URI.

**Rationale:** `listSessions()` already selects `jsonl_path`; a new tool adds a schema, a handler, and a test file for data already in hand. The source prompt left this to the architect's call, so the smaller surface wins.

### Destination is derived, never passed

**Decision:** `compactToParallelFile(jsonlPath, opts)` takes no destination parameter; the target comes only from `parallelShrunkPath()`.

**Alternatives:** `compactToParallelFile(src, dest)` with a validation check on `dest`; a shared `compactTo(src, dest)` used by both in-place and parallel modes.

**Rationale:** The ADR-015 constraint is "structurally incapable," not "validated." If no caller can express the source path as a target, there is no code path — including a forced CLI failure — that can produce one. `assertNotSource` remains as a cheap tripwire against a future edit to `parallelShrunkPath`, not as the primary defense.

### Do not modify `CompactResult`; add `ParallelCompactResult`

**Decision:** Declare `export type ParallelCompactResult = CompactResult & { path?: string }` and use it only as the new function's return type. `CompactResult`, `compactWindowLines`, and `compactFileInPlace` signatures stay untouched.

**Alternatives:** Add `path?: string` directly to `CompactResult`.

**Rationale:** Resolves the design's third Key Question by removing the risk rather than auditing for it. No existing consumer's type changes, so no consumer — exhaustively destructuring or otherwise — can break, and no verification sweep of other call sites is needed before implementation.

### Trigger placement: last statement in `reflect()`, after `advanceCursor`

**Decision:** The threshold check and call are appended as the final block of `reflect()` — after memory persistence, after the redaction-logging block, after `advanceCursor`, and after the disabled `compactFileInPlace` block (lines 274-288 unmodified, comments and ordering preserved). It reads `window.rawLines` from the in-memory window and is wrapped in its own `try { } catch { console.error }`.

**Alternatives:** Before `advanceCursor` (so the shrunk copy matches the exact window just consumed); inside the candidate-processing loop; replacing the disabled block in place.

**Rationale:** Compaction is a pure side-effect on a sibling file — it must never delay, roll back, or fail the extraction and cursor work that is the point of `reflect()`. Running last means a hang, throw, or slow subprocess costs only wall-clock, never correctness. `advanceCursor` mutates cursor state, not the `window` object, so the byte-size measurement is unaffected by ordering. Leaving the disabled block untouched satisfies the non-goal and keeps the existing `vcc_shrunk_at` tests green.

### Byte-size threshold on the unprocessed window

**Decision:** `Buffer.byteLength(window.rawLines.join('\n'), 'utf-8') > 200_000`, with the constant exported from `reflector.ts` as `VCC_PARALLEL_COMPACT_BYTES`.

**Alternatives:** Line-count threshold (500 lines); file-size `statSync` on the transcript; a config key in `extraction_models.yaml`.

**Rationale:** Byte size tracks what the CLI subprocess actually has to chew through and is immune to a handful of huge tool-result lines slipping under a line gate. Measuring the window rather than `statSync` avoids a filesystem call and ties the trigger to *new* activity. Kept as a code constant rather than config: no consumer has asked to tune it, and a config key would pull `core/config.ts` outside the stated scope ceiling. Exporting it lets `reflector.test.ts` build fixtures without a magic number.

### Regression test forces failure by mocking the CLI boundary, asserts via an `fs.renameSync` spy

**Decision:** `vcc-bridge.test.ts` mocks `node:child_process` `spawnSync` (the module's existing process boundary) to force non-zero exit or throw, and separately spies on `fs.renameSync` to assert it is never called with any argument resolving to `jsonlPath`. The success test asserts the sibling exists, the source is byte-identical to a pre-read buffer, and the return is `{ ok: true, path }`.

**Alternatives:** Force failure with an unwritable or invalid path on disk; mock `runCli` directly; no mocking at all with a stub CLI binary.

**Rationale:** Resolves the design's second Key Question. Permission-based failure is unreliable on Windows (this repo's primary platform) and would test the OS, not the invariant. Mocking `spawnSync` is deterministic and sits one level below `runCli`, so it exercises `runCli`'s real error handling instead of stubbing it away. The `renameSync` spy is the direct expression of the ADR-015 guarantee — it asserts the *absence* of a dangerous call, which no output-only assertion can do. Total mocking cost: two `vi.spyOn` calls, no module factory rewiring.

### Overwrite the shrunk sibling on re-trigger; no dedicated skip check

**Decision:** A later oversized window re-runs the compaction and `renameSync` replaces the existing sibling; the `UPDATE` rewrites the same deterministic path value.

**Alternatives:** Skip when `vcc_shrunk_path IS NOT NULL`; version the siblings (`.vcc-shrunk.<n>.jsonl`).

**Rationale:** The threshold already gates on *unprocessed* bytes, so a re-trigger means genuinely new bulk content exists and the old copy is stale. Overwriting keeps exactly one sibling per transcript — no unbounded file growth, no cleanup job — and makes the DB write idempotent. Skipping would freeze the shrunk copy at the first large window, which is the least useful snapshot.

---

## Open Questions

<!-- These must be resolved before /plan runs. Planner will fail if ambiguous. -->

- None. All three "Key Questions for the architect" are resolved above: insertion point (last block of `reflect()`, after `advanceCursor`, disabled block untouched); failure-forcing strategy (mock `spawnSync`, assert via an `fs.renameSync` spy); and `CompactResult` shape (unchanged — a new `ParallelCompactResult` alias instead, so no other call site can be affected and no audit is required).
- Deferred by design and explicitly out of scope for `/plan`: `nexus_search_session` (FEAT-20260808153312-b0), the post-archive optimization pass (FEAT-20260808153323-e6), and any re-enablement of `compactFileInPlace`.
