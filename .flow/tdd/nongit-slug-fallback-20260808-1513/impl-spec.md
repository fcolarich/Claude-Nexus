# Implementation Spec: Non-git-repo slug fallback + non-project-cwd noise gate

## Implementation Approach

Two independent tracks, matching the design's own split:

1. A documentation-only edit (`_documents/file-map.md`) — no code, no test impact.
2. A `classifyOrigin()` extension in `src/capture/origin.ts`, threaded through its
   two existing call sites (`reflector.ts`, `purge-origin.mjs`).

Track 2 is built test-first (red/green): the new test cases are written against
the not-yet-changed `classifyOrigin()` signature first (they will not compile/pass
until the implementation lands — expected), then the implementation is added to
make them pass, then the two call sites are updated to satisfy the new required
parameter. Track 1 has no code dependency and can land at any point.

Core logic shape (restated here in full since implementers work from this spec
and the `files` list, not from architecture.md directly):

```ts
export type OriginVerdict = {
  excluded: boolean
  reason?: string
}

export function classifyOrigin(
  transcriptPath: string,
  cwd: string,
  cfg: ExcludeConfig,
  env?: NodeJS.ProcessEnv
): OriginVerdict

// pure, no I/O — internal to origin.ts, not exported unless tests need direct access
function isNonProjectCwd(cwd: string, homedir: string): boolean
```

`isNonProjectCwd(cwd, homedir)`:

- Normalize `cwd` via `path.resolve()`.
- Return `true` if `normalized === path.parse(normalized).root` — this alone
  covers Windows drive roots and POSIX root, since Node's `path` module picks
  platform-correct root semantics from `process.platform`; no hand-rolled regex.
- Return `true` if `normalized` matches `path.resolve(homedir)` after stripping
  a trailing separator from both sides, comparing with `.toLowerCase()` only
  when `process.platform === 'win32'`.
- Otherwise `false`.

`classifyOrigin()` wiring:

- Runs the existing scheduled-task and command-name checks first, unchanged,
  same `NOT_EXCLUDED` fast path.
- If still not excluded, calls `os.homedir()` inside a try/catch.
- On throw: fail open — return the same `NOT_EXCLUDED` value as today, without
  calling `isNonProjectCwd`. Never let this new check be the reason a real
  memory is lost.
- On success: call `isNonProjectCwd(cwd, homedir)`. If `true`, return
  `{ excluded: true, reason: 'non-project-cwd:' + cwd }` — same `OriginVerdict`
  shape and reason-string convention already used for `'scheduled-task'` and
  `'command:<name>'`.

Signature change: `cwd` is inserted as a new required positional parameter
immediately after `transcriptPath`. Both existing call sites must add the
argument — `reflector.ts` sources it from the active session's `sessionCwd`;
`purge-origin.mjs` sources it from `session.cwd` on the session record already
read from `nexus.db`.

## Build Order and Dependencies

1. `src/capture/origin.test.ts` — new test cases + existing call sites adapted
   to the new signature (RED). No dependency.
2. `src/capture/origin.ts` — `isNonProjectCwd` + `classifyOrigin` extension
   (GREEN). Depends on (1) so the implementer works against a known-failing
   suite rather than inventing test shape mid-implementation.
3. `src/capture/reflector.ts` — thread `cwd` through the `reflect()` call
   site. Depends on (2).
4. `scripts/purge-origin.mjs` — thread `cwd` through the retroactive-pass
   call site. Depends on (2). Disjoint file from step 3 — runs in parallel
   with it.
5. `_documents/file-map.md` — accepted-limitation note + known-gap
   cross-reference. No code dependency — can land in parallel with
   everything else.

## Test Strategy per Component

- **origin.ts** — unit tests only, in `origin.test.ts`. Rationale:
  `isNonProjectCwd` is deliberately pure (no I/O) so it's directly
  unit-testable without mocking `os.homedir()`; the fail-open path is tested
  separately by mocking `os.homedir()` to throw. No integration test needed —
  this mirrors the existing scheduled-task/command-name test patterns already
  in the file, and there's no cross-process or DB behavior to integration-test.
- **reflector.ts** — no dedicated new test. The only change is threading an
  already-available value into an already-tested function call; `cwd` is a
  required `string` positional parameter, so TypeScript's compiler catches a
  missing or misordered argument at build time, and the decision logic itself
  is fully covered by `origin.test.ts`. A redundant test here would exercise
  the compiler, not new behavior.
- **purge-origin.mjs** — no dedicated new test. Same call-site-threading shape
  as `reflector.ts`, but this file is plain JS with no compile-time signature
  enforcement — see Edge Cases below for the mitigation (careful review, not
  a new test). The shared decision logic is already unit-tested via
  `origin.test.ts`; standing up test scaffolding for a one-argument change in
  a script with no existing test harness is disproportionate (YAGNI).
- **file-map.md** — none. Documentation only, no executable behavior.

## Edge Cases and Error Handling per Component

- **origin.ts / `isNonProjectCwd`** — trailing-separator variants of the home
  directory and drive roots must normalize identically; handled by
  `path.resolve()` + trailing-separator stripping, not hand-rolled regex.
  Case-insensitivity applies only on `win32` (POSIX paths are case-sensitive).
  A real, possibly-shallow project directory (e.g. the RumbleMoney project)
  must NOT match — this regression case is required by the design's Success
  Criteria and must be asserted explicitly, not just the positive-match cases.
- **origin.ts / `classifyOrigin`** — `os.homedir()` throwing must fail open
  (return `NOT_EXCLUDED`), matching the existing transcript-read fail-open
  precedent already in this file. The new check must run after, and never
  interfere with, the existing scheduled-task/command-name checks and their
  fast path.
- **reflector.ts** — no new runtime edge case beyond the added parameter;
  `sessionCwd` availability is a compile-time concern (required param), not
  something to defensively handle here.
- **purge-origin.mjs** — confirm during implementation that session records
  read from `nexus.db` carry a non-null `cwd` column; if some don't, that's a
  pre-existing data-quality condition outside this feature's scope, not a new
  bug to fix here. The destructive path (`--apply` / `VACUUM INTO` snapshot)
  is unchanged by this feature and remains fail-closed by its existing design
  — this feature only changes which sessions get flagged, never the deletion
  mechanics. Because this file has no compiler to catch a misordered argument,
  the argument order must be checked by hand against `origin.ts`'s signature.
- **file-map.md** — must explicitly reference this feature's design doc for
  the rationale (required by Success Criteria), and must carry the
  custom-parent-folder known-gap note (see below).

## Resolved Open Question (architecture.md)

The `C:\Fran`-style custom-parent-folder gap (a cwd that is neither the OS
home dir nor a filesystem/drive root) is documented as a known gap only, in
`_documents/file-map.md`'s `project-root.ts` row, cross-referencing this
design's Non-goals and Key Questions sections. No `add-feature` entry is
filed. This is the lower-ceremony option: the design doc already fully
documents the gap under Non-goals and Key Questions, so a new feature entry
would duplicate existing documentation for a gap with no scoped follow-up
work. This is a documented known gap, not a blocking ambiguity, and does not
gate this feature's implementation.

## Coverage Matrix

| Acceptance Criterion | Covered by |
| --- | --- |
| AC-1: file-map.md documents non-git fallback as accepted limitation, referencing this design | task-005 |
| AC-2: cwd === os.homedir() excluded with non-project-cwd reason, unit test | task-001, task-002 |
| AC-3: cwd is a drive root or POSIX root excluded the same way | task-001, task-002 |
| AC-4: real project directory cwd is NOT excluded (regression test) | task-001, task-002 |
| AC-5: forced internal error (os.homedir() throws) fails open, NOT_EXCLUDED | task-001, task-002 |
| AC-6: purge-origin.mjs retroactive pass and reflect() live gate exercise the same classifyOrigin() logic, no drift | task-002, task-003, task-004 |
| AC-7: existing origin.test.ts suite (scheduled-task, command-name, NEXUS_NO_CAPTURE) continues to pass, mechanically adapted call sites only | task-001, task-002 |
