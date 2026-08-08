# Architecture: Non-git-repo slug fallback + non-project-cwd noise gate

## Components

### origin.ts (`src/capture/origin.ts`)

**Responsibility:** Decide whether a session may capture memories at all, before any other capture logic runs; owns `OriginVerdict`, `ExcludeConfig`, and every exclusion check (scheduled-task, command-name, and the new non-project-cwd check).

**Interface:**

```ts
export type OriginVerdict = {
  excluded: boolean
  reason?: string   // e.g. 'scheduled-task', 'command:<name>', 'non-project-cwd:<cwd>'
}

// cwd is a NEW required parameter, inserted immediately after transcriptPath.
// Existing scheduled-task / command-name checks and the NEXUS_NO_CAPTURE
// fast path are unchanged; the new check runs alongside them, same
// fail-open contract.
export function classifyOrigin(
  transcriptPath: string,
  cwd: string,
  cfg: ExcludeConfig,
  env?: NodeJS.ProcessEnv
): OriginVerdict

// Pure, no I/O — unit-testable without mocking os.homedir().
// Not exported unless tests need direct access; internal to origin.ts.
function isNonProjectCwd(cwd: string, homedir: string): boolean
```

### reflector.ts (`src/capture/reflector.ts`)

**Responsibility:** Live capture pipeline; owns calling `classifyOrigin()` with the active session's cwd before running extraction, and skipping/logging on exclusion.

**Interface:**

```ts
# inside reflect() — cwd sourced from the active session context
const verdict = classifyOrigin(transcriptPath, sessionCwd, cfg, process.env)
if (verdict.excluded) {
  log(`skip capture: ${verdict.reason}`)
  return
}
```

### purge-origin.mjs (`scripts/purge-origin.mjs`)

**Responsibility:** Retroactive pass that re-classifies already-captured sessions using the same `classifyOrigin()` logic, so live and retroactive classification never drift; fails closed (never deletes on an unclassifiable memory).

**Interface:**

```text
# for each session record read from nexus.db (transcriptPath, cwd)
const verdict = classifyOrigin(transcriptPath, session.cwd, cfg, process.env)
# verdict.excluded === true  -> candidate for purge (dry-run by default,
#                                 --apply snapshots via VACUUM INTO first)
```

### file-map.md (`_documents/file-map.md`)

**Responsibility:** Document the non-git fallback behavior of `project-root.ts` as an accepted limitation, so the gap is discoverable without re-deriving it from code.

**Interface:**

```text
# project-root.ts row — appended note, no schema change
"...falls back to raw-cwd slugging when outside a git repo (no
subdirectory unification); accepted limitation, see FEAT-003 design."
```

---

## Data Flow

### Live session capture (`reflect()`)

1. `reflect()` receives `transcriptPath` and the session's `cwd` from the active session context
2. `reflect()` calls `classifyOrigin(transcriptPath, cwd, cfg, process.env)`
3. `classifyOrigin()` runs the existing scheduled-task and command-name checks first (unchanged, same `NOT_EXCLUDED` fast path)
4. If still not excluded, `classifyOrigin()` calls `os.homedir()` inside a try/catch, then calls `isNonProjectCwd(cwd, homedir)`
5. If `isNonProjectCwd` returns `true`, `classifyOrigin()` returns `{ excluded: true, reason: 'non-project-cwd:<cwd>' }`; `reflect()` logs the reason and skips extraction
6. If the `os.homedir()` call throws, the catch block treats the check as not-excluded; `classifyOrigin()` returns `{ excluded: false }` and capture proceeds normally (fail open)

### Retroactive purge (`purge-origin.mjs`)

1. `purge-origin.mjs` reads each session record (`transcriptPath`, `cwd`) from `nexus.db`
2. For each session, it calls `classifyOrigin(transcriptPath, session.cwd, cfg, process.env)` — identical call shape and identical logic to the live path, no separate implementation
3. If the verdict is excluded, the session's memories are flagged for purge (dry-run output by default)
4. With `--apply`, the DB is snapshotted via `VACUUM INTO` before any deletion — fail-closed: an unclassifiable memory (verdict-check error) is never deleted, distinct from `classifyOrigin()`'s own fail-open contract on its internal checks

---

## Storage

### Exclusion reason string convention (not a new table)

```text
reason: string  # '<check-name>[:<detail>]'
                # existing: 'scheduled-task', 'command:<name>'
                # new:      'non-project-cwd:<cwd>'
```

No schema change. This is the existing `excluded_reason` string already logged by both call sites (per recent commit history); the new check just adds one more reason prefix to the same convention.

---

## Decisions

### classifyOrigin() signature: new required `cwd` positional parameter

**Decision:** Insert `cwd` as a new required positional parameter immediately after `transcriptPath`: `classifyOrigin(transcriptPath, cwd, cfg, env?)`.

**Alternatives:** (a) fold `cwd` into `ExcludeConfig` as an optional field; (b) collapse everything into a single options object.

**Rationale:** Only two call sites exist (`reflector.ts`, `purge-origin.mjs`) and both already require updating per the design's own goals — a positional insert is a one-line diff at each site, and TypeScript raises a compile error at any call site that forgets the new argument. An optional `ExcludeConfig` field could be silently omitted and fail open by accident rather than by design. An options-object rewrite touches more surface than a two-argument, two-call-site change justifies (no over-engineering).

### Portable drive-root/home-dir detection via `path.parse().root`

**Decision:** Normalize `cwd` with `path.resolve()`, then treat it as a filesystem root if `normalized === path.parse(normalized).root`. Compare against `os.homedir()` using `path.resolve()` plus trailing-separator stripping on both sides, with a `toLowerCase()` comparison only when `process.platform === 'win32'`.

**Alternatives:** hand-rolled regexes per OS (`/^[A-Za-z]:\\?$/` for Windows drive roots, `/^\/$/` for POSIX root).

**Rationale:** Node's `path` module already picks platform-correct root semantics based on `process.platform`, so `path.parse().root` handles `C:\`, `C:/`, and POSIX `/` without maintaining two regexes and their edge cases (UNC paths, trailing-slash variants, drive-letter case). Reusing built-in logic is less code and less to get wrong than duplicating it.

### Fail-open via pure-function / I-O split

**Decision:** Split the check into a pure `isNonProjectCwd(cwd, homedir)` (no I/O, always returns a boolean) and let `classifyOrigin()` own the only fallible call (`os.homedir()`) inside a try/catch that returns `NOT_EXCLUDED` on any throw.

**Alternatives:** one combined function that performs the `os.homedir()` lookup and comparison internally, with its own try/catch returning `false` on error.

**Rationale:** Matches the existing transcript-read fail-open precedent in `origin.ts` (I/O wrapped at the boundary, comparison logic pure), and makes the pure matching logic directly unit-testable without mocking `os.homedir()` — while the fail-open path is tested separately by making a mocked `os.homedir()` throw. This maps directly onto the design doc's two distinct success criteria (narrow-match regression test vs. fail-open test).

### Documentation placement: `file-map.md` only

**Decision:** Document the non-git fallback as an accepted limitation in `_documents/file-map.md`'s `project-root.ts` row only, via the `update-file-map` skill. Do not also edit `CLAUDE.md`'s Conventions section.

**Alternatives:** `CLAUDE.md` Conventions section only; both.

**Rationale:** Per this project's own doc-maintenance protocol table, `file-map.md` is where individual file/module behavior lives ("Summary of important files/folders"), while `CLAUDE.md`'s Conventions section is for cross-cutting rules (tabs, thin controllers, slug format, etc.). This is a single-file behavioral note specific to `project-root.ts`, not a new cross-cutting convention — one doc, one place, no duplication. Resolves design doc Key Question 4.

---

## Open Questions

<!-- These must be resolved before /plan runs. Planner will fail if ambiguous. -->
- `C:\Fran`-style custom-parent-folder noise (neither home dir nor drive root) is explicitly out of scope per the design's Non-goals and is not addressed by the home-dir/drive-root check specified above. Planner must decide: file an `add-feature` entry now for a future broader heuristic, or leave it as a known gap documented only in the design doc. This does not block implementing this feature.
