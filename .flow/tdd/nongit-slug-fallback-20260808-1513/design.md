# Design: Non-git-repo fallback for project-slug resolution (FEAT-003) + non-project-cwd noise gate

## Problem

`resolveGitProjectRoot()` in `src/core/project-root.ts` falls back to the raw,
unmodified `cwd` when git is unavailable, times out, or `cwd` isn't inside a
git repository — the catch block just returns `cwd`. `cwdToProjectSlug()`
then slugs that raw string with no root-collapsing, so two subdirectories of
the same non-git project resolve to two different slugs — the exact
subdirectory-fragmentation problem ADR-013 fixed for the git case.

A related, adjacent problem surfaced while investigating this: a direct query
against the real `nexus.db` (`SELECT DISTINCT cwd FROM sessions`) found 62
distinct session cwds, of which 4 are non-git. Of those 4, 3 are not real
projects at all — `C:\`, `C:\Fran`, and `C:\Users\Fran` — almost certainly
sessions started outside any real project directory (home dir, a parent
folder, a drive root). Only `C:\Fran\RumbleMoney` is a genuine non-git
project. These noise sessions currently capture memories under fragmented,
meaningless project slugs.

## Goals

- Document the non-git fallback behavior as an accepted limitation — no
  code change to `resolveGitProjectRoot()`/`cwdToProjectSlug()` for the
  general non-git-subdirectory-fragmentation case.
- Add a narrow, high-confidence exclusion so sessions whose `cwd` is the
  user's home directory or a filesystem/drive root never capture memories
  under a fragmented, meaningless slug.
- Keep the new check consistent with `origin.ts`'s existing gate
  conventions: fail open, same `OriginVerdict`/`excluded_reason` shape,
  same call sites (`reflect()` and `scripts/purge-origin.mjs`).

## Non-goals

- Not building a non-git project-root heuristic (nearest `package.json`,
  marker files, etc.). Explicitly rejected: project policy is "all real
  projects should have a git repo" — the empirical population of genuine
  non-git projects is one (`RumbleMoney`), too small to justify a second
  root-resolution code path, its own migration tooling, and the
  which-marker-wins ambiguity that comes with it.
- Not building a broader "is this a real project folder" heuristic beyond
  home-dir/drive-root. The user explicitly chose the narrow denylist over a
  broader depth-based heuristic to avoid false-excluding real shallow
  projects.
- Known gap, called out rather than silently accepted: the chosen narrow
  denylist (home dir + drive roots) does **not** catch `C:\Fran` — a
  custom parent folder that is neither the OS home dir nor a drive root.
  That noise case remains unaddressed by this feature; flagged as a Key
  Question below rather than expanding the denylist without a decision.
- Not retroactively migrating or deleting memories already captured under
  the 3 observed noise slugs. This feature guards future capture; a
  retroactive cleanup (if wanted) is a separate, explicitly-scoped
  follow-up, matching how `scripts/purge-origin.mjs` was built separately
  from `origin.ts`'s live gate.

## Constraints

- No new git-root-resolution code path for non-git projects.
- The noise-cwd check must fail open on its own errors (e.g. unable to
  read `os.homedir()` or resolve a drive root) — never the reason a real
  memory is lost, matching `classifyOrigin`'s existing fail-open precedent.
- Reuse `origin.ts`'s `OriginVerdict` shape and `ExcludeConfig` pattern
  rather than inventing a parallel gate mechanism.

## Proposed Approach

Two independent, small changes:

1. **Documentation only, for the general non-git case.** Update
   `CLAUDE.md`'s relevant convention note (or `_documents/file-map.md`'s
   `project-root.ts` entry) to state explicitly: non-git projects fall
   back to raw-cwd slugging with no subdirectory unification, and this is
   an accepted limitation given project policy that real projects use git.
   No code change to `project-root.ts`.

2. **Extend `classifyOrigin()` in `src/capture/origin.ts`** with a new
   check: if `cwd` (passed alongside the existing `transcriptPath`/`cfg`
   params — signature changes needed, architect to specify exact shape)
   equals `os.homedir()` or matches a drive-root/filesystem-root pattern
   (`C:\`, `D:\`, ..., or POSIX `/`), return
   `{ excluded: true, reason: 'non-project-cwd:<cwd>' }`. This runs
   alongside the existing scheduled-task and command-name checks, sharing
   the same `NOT_EXCLUDED` fast path and the same fail-open contract (if
   the check itself throws — e.g. `os.homedir()` unavailable — treat as
   not excluded, matching the transcript-read fail-open precedent already
   in the module).

Both call sites that currently invoke `classifyOrigin()` — `reflect()` in
`src/capture/reflector.ts` and `scripts/purge-origin.mjs` (the retroactive
pass) — need the new `cwd` parameter threaded through, so live-going-forward
and retroactive classification cannot drift apart, matching the module's own
stated design principle in its header comment.

### Alternatives considered

- **Nearest-marker-file heuristic** (package.json/pyproject.toml walk-up):
  rejected. Fixes the general non-git fragmentation case but requires its
  own migration tooling (mirroring ADR-013) for a population of one real
  project — cost clearly exceeds benefit right now.
- **Retroactive-merge-only via project-migrate.ts**: rejected as the
  primary approach for the same reason — no live heuristic exists to
  retroactively migrate onto, since we're not building one. (A retroactive
  cleanup of the 3 *already-captured* noise sessions is a separate,
  not-yet-scoped follow-up, per Non-goals above.)
- **Broader depth-based non-project heuristic**: rejected by the user in
  favor of the narrow, high-confidence home-dir/drive-root denylist, to
  avoid false-excluding real shallow projects.

## Key Questions (for architect)

- Exact signature change for `classifyOrigin()` — does `cwd` become a new
  required parameter, or is it folded into `ExcludeConfig`/a new options
  object? Must not silently change behavior for existing callers relying
  on the current 2-arg (+env) signature; architect should specify the
  minimal-diff shape, and confirm the same shape is threaded through both
  `reflector.ts` and `purge-origin.mjs`.
- Drive-root detection needs to be OS-portable in code (this project also
  documents POSIX paths, e.g. `_home/<user>`in the design conversation) —
  architect should confirm the exact regex/logic for both Windows drive
  roots (`C:\`, `C:/`) and POSIX root (`/`), and for `os.homedir()`
  normalization (trailing slash handling, case-insensitivity on Windows).
- `C:\Fran`-style custom-parent-folder noise (neither home dir nor drive
  root) is explicitly out of scope per Non-goals — should this be
  captured as a follow-up `add-feature` entry now, or left purely as a
  known gap in this doc? Architect/planner's call; not blocking this
  feature's implementation.
- Where exactly should the documentation update land — `CLAUDE.md`'s
  Conventions section, or `_documents/file-map.md`'s `project-root.ts`
  row, or both? Planner to decide based on which doc-maintenance skill
  fits (`update-file-map` vs. a direct CLAUDE.md edit) per this project's
  own doc-maintenance protocol.

## Success Criteria

- `_documents/file-map.md` (or `CLAUDE.md`, per the architect/planner's
  placement decision) explicitly documents the non-git fallback as an
  accepted limitation, referencing this feature/design for the rationale.
- A session whose `cwd` is exactly `os.homedir()` is excluded by
  `classifyOrigin()` with `excluded: true` and a reason string identifying
  it as a non-project-cwd exclusion — verified via a unit test mirroring
  `origin.test.ts`'s existing scheduled-task/command-name test patterns.
- A session whose `cwd` is a drive root (`C:\`) or POSIX root (`/`) is
  excluded the same way.
- A session whose `cwd` is a real project directory (e.g.
  `C:\Fran\claude-nexus`, or the observed `C:\Fran\RumbleMoney`) is **not**
  excluded by this new check — a regression test proving the narrow
  denylist doesn't over-match.
- Forcing an internal error in the new check (e.g. a test double that
  makes `os.homedir()` throw) results in `classifyOrigin()` returning
  `NOT_EXCLUDED` rather than propagating an exception — fail-open
  confirmed, matching the transcript-read precedent already in the file.
- `scripts/purge-origin.mjs`'s retroactive pass and `reflect()`'s live
  gate both exercise the same updated `classifyOrigin()` logic — no
  drift between the two call sites, matching the module's stated
  design principle.
- Existing `origin.test.ts` suite (scheduled-task denylist, command-name
  denylist, `NEXUS_NO_CAPTURE` opt-out) continues to pass unmodified.

---
**Checkpoint — DESIGN**
- Goal: document non-git fallback as an accepted limitation (no root-heuristic code), and add a narrow home-dir/drive-root exclusion to origin.ts's classifyOrigin() to stop capturing memories under the 3 observed noise-cwd sessions.
- Constraint: no new git-root-resolution path; new check must fail open; reuse origin.ts's existing OriginVerdict/ExcludeConfig pattern rather than a new gate mechanism.
- Approach: two independent small changes — a docs update, and a classifyOrigin() extension threaded through both reflect() and purge-origin.mjs so live and retroactive classification never drift.
- Open question for architect: exact classifyOrigin() signature change (new param vs. config field) and portable drive-root/home-dir detection logic across Windows and POSIX.
