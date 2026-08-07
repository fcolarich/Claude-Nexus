# Implementation Spec — vcc Extraction Tuning (3 Features)

Session: vcc-extraction-tuning-20260730-2110
Branch: feature/vcc-extraction-tuning
Files in scope: `src/capture/extract.ts`, `src/capture/reflector.ts`, `src/capture/docspine.ts` (read-only, unchanged), plus test files `src/capture/extract.test.ts`, `src/capture/reflector.test.ts`.

## Resolved Open Questions

**Q1 — decisions/ filename convention (architecture.md Open Question 1).** Checked `_documents/architecture.md` (generated ADR index). ADR-001 through ADR-014 use short-form filenames (`adr-NNN-slug.md`) — `readDecisionIndex()` correctly derives `ADR-NNN`. **ADR-015, which landed today (2026-07-30), uses timestamp-form** (`adr-20260730134500-2c-supersede-insert-reference-upgrade-exception-in-re.md`) — id-derivation yields `ADR-20260730134500`, not `ADR-015`. The docspine.ts quirk flagged as "possibly moot" is **not moot — it is live, starting with this repo's own newest decision record.** Any future citation to ADR-015 or later will fail-closed (safe) but silently never validate, regardless of this feature. Out of scope to fix here (non-goal). Recommend a follow-up FEAT against `docspine.ts`'s id-derivation once this batch ships. Task-003's fixtures deliberately use short-form filenames (matching ADR-001–014) — the only form the current parser resolves correctly.

**Q2 — reflector.test.ts direct calls to isReferenceUpgrade (architecture.md Open Question 2).** Confirmed: `isReferenceUpgrade` is never imported or invoked directly in `reflector.test.ts` — only exercised indirectly through `reflect()`. Adding the required third `validIds` param is **not signature-breaking for any test call site.** However: none of the existing tests in the `'Fix 1 — ADR-reference demotion (supersede-insert)'` describe block set `opts.cwd`, so `readDecisionIndex(opts.cwd)` returns `[]` and `validIds` is empty for all of them today — under current (pre-fix) shape-match-only logic that's irrelevant, but once the fail-closed check lands, 4 of those tests will regress from their current passing assertions unless retrofitted with a `cwd` fixture. This is not "purely additive" as the optimistic reading suggested — it is additive-plus-four-retrofits. Scoped explicitly into task-003.

## Implementation Approach

### Extractor (extract.ts) — phase-cue + source-aware cap
Two unrelated edits, different regions of the same file, no interaction between them:
- Phase-cue is a pure prompt-text insertion. Architect confirmed no pre-existing addendum exists in this file — write it fresh, do not search for text to "fold into."
- Source-aware cap: split `MAX_CANDIDATES` into two named constants, parameterize `parseCandidates` (default param keeps any bare `parseCandidates(raw)` caller compiling and behaviorally identical), branch once in `extractMemories()` on `ctx.source`. Capping logic lives in exactly one place — do not duplicate the branch elsewhere (e.g. do not also cap inside `reflect()`).

### Reflector (reflector.ts) — source threading + validIds threading
Both new locals (`source`, `validIds`) are derived inside the same function (`reflect()`), within roughly 15 lines of each other, from state that already exists (`compacted.ok`, and the unchanged `readDecisionIndex()` return value). Neither depends on the other's value, but they are physically adjacent edits in the same function body — land source-threading (task-002) before validIds-threading (task-004) so the second edit's anchors are applied against an already-settled version of the function rather than two unsequenced edits landing in the same 15-line span. `isReferenceUpgrade`'s new third param is required, not defaulted — the only production call site is fully controlled in this same change; a silent default would mask exactly the bug this feature fixes.

### Doc-Spine Reader (docspine.ts) — untouched, read-only reference
No code change this batch. Task-003 reads it once to confirm the `cwd` → `_documents/decisions/` join convention before building a test fixture that mimics it correctly.

## Build Order and Dependencies

1. **task-001** — extract.ts, SYSTEM_PROMPT paragraph. Independent, no deps.
2. **task-002** — extract.ts constants/functions + reflector.ts source-threading + extract.test.ts. Independent, no deps. Shares extract.ts with task-001 but in a different, ~100-line-distant region (prompt text block vs. constants/function bodies) — low collision risk, not sequenced against it.
3. **task-003** — reflector.test.ts fixture helper + 4 retrofitted tests + 2 new tests (TDD red). Independent, no deps. Reads reflector.ts and docspine.ts but modifies neither — safe to run alongside task-002's reflector.ts edit.
4. **task-004** — reflector.ts isReferenceUpgrade fail-closed logic (TDD green). Depends on task-002 (same function, adjacent lines — source-derivation must land first) and task-003 (tests must already exist to implement against).

Parallel-eligible: task-001, task-002, task-003 (no pairwise blocking dependency; task-001/task-002 share a file in disjoint regions). Sequential: task-004 runs only after both task-002 and task-003 complete.

## Test Strategy per Component

- **Extractor / phase-cue — none.** Prompt wording is not meaningfully unit-testable (explicit design constraint) — no assertion pins exact SYSTEM_PROMPT text. Only obligation: don't break a pre-existing snapshot/assertion in extract.test.ts if one already exists.
- **Extractor / source-aware cap — unit.** `parseCandidates`/`extractMemories` are pure functions — no DB, no fixtures, fast and isolated. Real branching logic (which constant applies) and a real boundary condition (cap at 20 vs 40) — exactly the kind of logic the design calls out as worth testing.
- **Reflector / source-threading — none, dedicated.** One-line plumbing addition (pass an already-computed boolean-derived value into an existing object literal), no new branch, no new state. A wiring break would already surface indirectly through existing reflector.test.ts assertions on `receivedText`. Not worth a dedicated new test for coverage's sake alone.
- **Reflector / validIds fail-closed — integration**, matching existing reflector.test.ts convention (real better-sqlite3 db, injected fake `deps`). This is exactly the real-risk logic the design flags: a fail-closed boundary condition (empty set / unresolved id / valid id) with a persisted-state consequence (`superseded_by`). Exercised via `reflect()`, not by exporting `isReferenceUpgrade` for direct unit testing — it has no production caller outside reflector.ts today; don't add an export just to test it in isolation.
- **Doc-Spine Reader — none.** Unchanged this batch, no new test surface.

## Edge Cases and Error Handling per Component

**Extractor (cap):**
- `ctx.source` omitted/undefined → treat as `'generic'` (matches architecture.md's documented default) → cap stays 20. Must not throw on missing `source`.
- Raw JSON has fewer candidates than either cap → no-op, existing behavior unchanged.
- Raw JSON has more than 40 (vcc cap) → still truncates at 40 — same "silent tail drop" limitation as today, just at a higher ceiling. Not fixed this batch, only raised.

**Reflector (validIds / isReferenceUpgrade):**
- `validIds` empty (no doc-spine, `opts.cwd` undefined, or an empty `_documents/decisions/`) → `isReferenceUpgrade` always `false` → falls through to the existing `touchMemory` path. Must not throw, must not drop the candidate.
- Candidate body has no ADR/DDR shape match at all → unchanged, existing early return `false` — this path predates this fix, do not touch it.
- Candidate body shape-matches but the id isn't in `validIds` (hallucinated id, or a real-but-timestamp-form id per Q1 above) → `false`, touch-and-continue. Indistinguishable from the "no doc-spine" case from the caller's perspective — intentional, same safe fallback either way.
- Matched row isn't `memory_type: 'decision'` → unchanged, existing gate, independent of `validIds`.
- Supersede-insert transaction throws mid-flight (existing rollback test) → must still roll back cleanly with the new 3-arg call; `validIds` is read-only and never mutated inside the transaction, so it introduces no new failure mode.

**Doc-Spine Reader:**
- Timestamp-form filenames (ADR-015 onward, confirmed live in this repo as of today) → `readDecisionIndex()` yields `ADR-20260730134500`-style ids that will never match a short-form citation like `ADR-015` → fails closed (safe) but silently ineffective for any citation to a decision created under the new naming scheme. Known, out of scope, not fixed here. Recommend filing a follow-up FEAT against `docspine.ts`'s id-derivation.
