# Design — Promotion/Demotion & Staleness Detection

Source: `_documents/research/claude-nexus-improvements-synthesis.md`, items 6 and 7.

## Problem

Nexus's recall ranking (`effectiveConfidence × helpRate`, DDR-003) and time-decay
(`decay.ts`) already handle two axes of memory quality: intrinsic confidence and
age-based decay. Two axes are missing:

1. **Trend-based governance (item 6).** `help_count`/`use_count` accumulate on every
   `recordFeedback()` call but nothing ever acts on the trend. A memory that has
   proven reliably unhelpful across many recalls stays at its original confidence
   forever; one that's proven reliably helpful gets no reinforcement beyond the
   occasional manual `touchMemory()` verify.
2. **Contradiction detection (item 7).** Dedup (`consolidate.ts`) only collapses
   *semantically similar* memories (≥0.86 cosine → `superseded_by`). Memories that
   are topically related but *factually conflicting* (e.g. two decisions asserting
   incompatible facts) have no detection mechanism. `memory_links.link_type`
   already has a `'contradicts'` value in its CHECK constraint — defined in the v2
   migration, never written by any code path today.

## Goals

- Add a periodic pass that adjusts confidence based on accumulated help-rate trend,
  once a memory has enough uses to judge, without violating the documented
  invariant that `confidence` is changed only by reconfirmation/verify/feedback
  (`decay.ts` header comment) — a help-rate trend *is* accumulated feedback.
- Add a periodic pass that flags candidate-contradictory memory pairs for human
  review, using the existing `'related'` similarity band (already computed by
  `linkMemory()`) as a cheap pre-filter, then a bounded number of Haiku calls to
  confirm actual semantic conflict before writing anything.
- Zero suppression: nothing is auto-deleted, auto-hidden, or auto-superseded by
  either pass. Both are surfacing mechanisms; a human (or a future, separately
  designed pass) decides what to do with a flagged pair.
- No new schema. Both items reuse existing columns/tables:
  `memories.confidence`, `.use_count`, `.help_count`, `.decay_class`,
  `memory_links.link_type = 'contradicts'`, `diagnostics.type = 'stale'`.

## Non-goals

- Not touching `decay.ts`'s time-based decay mechanism (`decayFactor`,
  `effectiveConfidence`) — orthogonal axis, explicitly out of scope per the
  synthesis and per DDR-003.
- Not building a general "supersedes" relationship or auto-resolution of
  contradictions — flagged pairs are surfaced only; resolution is a human action
  (possibly via a future `nexus_mark_promoted`-style tool, not in this scope).
- Not adding a new review_status value or new diagnostics CHECK value — both would
  require a table-rebuild migration; reusing existing enum values avoids that.
- Not building this as an LLM-only judgment call for item 6 — helpRate governance
  is pure arithmetic over existing counters, no model call needed.
- Not rate-limiting or budgeting Haiku spend beyond a fixed per-run pair cap (see
  Key Questions) — no adaptive cost model in this pass.

## Constraints

- No schema changes (per task scope — both items must fit existing columns/CHECK
  values, confirmed feasible during design: `memory_links.link_type` already
  permits `'contradicts'`; `diagnostics.type` already permits `'stale'`).
- Must not modify `src/core/decay.ts`.
- Item 7 requires its own DDR before implementation per the synthesis's explicit
  hard constraint (false-positive risk of suppressing valid memories) — this
  design doc's contradiction section IS that DDR's input; the `add-ddr` skill
  will be invoked during/after implementation per CLAUDE.md's doc-maintenance
  protocol, and a DDR must exist before the contradiction-detection code merges.
- Both passes are folded into the existing `nexus_consolidate` MCP tool / `nexus
  consolidate`-equivalent call path (user decision), not new standalone tools.
  `consolidateMemories()` gains two additional phases after its existing three
  (backfill embeddings → prune rejected → merge near-dups → **govern by help-rate
  trend → detect contradictions**).

## Proposed Approach

### Item 6 — Help-rate trend governance

New function `governByHelpRate(db, opts)` in `src/core/consolidate.ts` (or a new
co-located module `src/core/governance.ts` if `consolidate.ts` gets unwieldy —
architect's call), run as a new phase inside `consolidateMemories()`:

1. Select all `approved`, non-superseded memories with `use_count >= MIN_EVALUATIONS`
   (default 5).
2. For each, compute `helpRate = help_count / use_count`.
3. **Demote** if `helpRate < LOW_THRESHOLD` (default 0.3): `confidence = MAX(FLOOR,
   confidence * 0.85)` (default `FLOOR = 0.1`). Do NOT touch `last_verified_at` —
   demotion isn't a reconfirmation and shouldn't restart the decay grace period.
4. **Reinforce** if `helpRate > HIGH_THRESHOLD` (default 0.8): `confidence =
   MIN(1.0, confidence + 0.05)` (mirrors `touchMemory`'s existing bump) AND reset
   `last_verified_at = datetime('now')` — sustained real usage is treated as an
   implicit reconfirmation, consistent with `touchMemory`'s existing semantics.
5. Between the two thresholds: no action (dead zone, avoids thrashing memories
   with middling help-rates every run).
6. After evaluation (whichever branch, including the dead zone — the window is
   consumed either way once judged): reset `use_count = 0, help_count = 0` so the
   next window starts fresh. This makes the mechanism a genuine *trend* signal
   (each window judged independently) rather than a lifetime average that a single
   old bad window can never dilute.
7. Return counts (`demoted`, `reinforced`) added to `ConsolidateResult`.

All of this is pure SQL over existing columns — no embeddings, no network calls,
cheap to run on every `consolidateMemories()` call.

### Item 7 — Contradiction candidate detection

New function `detectContradictions(db, haikuFn)` in the same module, added as the
final phase of `consolidateMemories()`:

1. **Shortlist via existing 'related' links.** Query `memory_links WHERE link_type
   = 'related'` (the 0.70–0.86 cosine band `linkMemory()` already populates on
   every embed) joined to both memories, restricted to `approved`,
   non-superseded, same `scope`/`project`.
2. **Cheap divergence pre-filter** (no LLM cost) — only pairs where
   `abs(confidence_a - confidence_b) > 0.3 OR decay_class_a != decay_class_b`
   proceed. Rationale: two memories that are topically related (cosine 0.70–0.86)
   but were assessed at very different confidence, or belong to different
   decay classes, are the ones most likely to represent "this one is probably
   outdated / superseded in spirit but the other is still trusted" rather than
   just two restatements of the same fact.
3. **Bounded Haiku confirmation.** Cap at `MAX_PAIRS_PER_RUN` (default 20) shortlisted
   pairs per `consolidateMemories()` call (processed oldest-checked-first via a
   `linked_at`-style ordering, so a large backlog drains over several runs rather
   than spiking one run's latency/cost). For each pair, one Haiku call: "Do these
   two memories assert genuinely incompatible facts, or are they compatible/just
   topically related?" — structured yes/no + one-line reason.
4. **On confirmed contradiction:** write a `memory_links` row
   `link_type = 'contradicts'` (bidirectional, via the existing `upsertLink()`
   helper — no new linking code needed, the CHECK constraint already allows this
   value) AND a `diagnostics` row (`type = 'stale'`, reusing the existing
   CHECK-permitted value used by `flagStaleMemories`, with
   `details = { reason: 'contradiction', memory_ids: [...], haiku_reason }`) so
   the pair surfaces in `nexus_health`'s existing `diagnosticsByType` summary
   without any changes to the health tool itself.
5. **On no-conflict / Haiku unavailable / call failure:** skip silently, no write.
   Never treat "couldn't check" as "is a contradiction."
6. Nothing is deleted, hidden from recall, or auto-superseded. A human reviewing
   `nexus_health` diagnostics or the `memory_links` graph decides what to do next
   (verify one, reject one, manually supersede, or dismiss as a false positive).

## Key Questions

1. **Module placement** — does `governByHelpRate`/`detectContradictions` belong in
   `consolidate.ts` directly, or a new `governance.ts` that `consolidate.ts`
   imports and sequences? Architect to decide based on resulting file size/cohesion.
2. **Haiku call plumbing** — `consolidateMemories()` currently takes only an
   `embedFn` parameter and is synchronous-shaped apart from that. `detectContradictions`
   needs a Haiku-calling function analogous to how `extract.ts` calls Haiku via the
   Agent SDK. Architect to confirm whether to inject a `haikuFn` parameter (testable,
   mirrors the `embedFn` injection pattern already used) or import the extraction
   client directly.
3. **`MAX_PAIRS_PER_RUN` ordering** — need a cheap way to avoid re-checking the same
   already-cleared pair every run. Options: track via a `memory_links` row already
   existing with `link_type='related'` and skip pairs that already have *any*
   `contradicts` OR a prior "checked, no conflict" marker. Since we must not add
   schema, the simplest option is: once Haiku says "no conflict," write nothing —
   meaning the pair will be re-shortlisted and re-checked (small Haiku cost) on
   every future run until one memory changes enough to leave the 'related' band or
   gets superseded. Architect should confirm this repeat-cost is acceptable at
   expected memory volumes, or propose a cheap dedup key (e.g. an in-memory/log-based
   skip list is out — needs to persist across process restarts) — **this is the
   one place a no-new-schema constraint might need revisiting** if repeat Haiku
   cost proves too high; flag explicitly rather than silently picking an option.
4. **DDR timing** — should the `add-ddr` skill run before or after `execute` for
   item 7 specifically? Recommendation: after `plan`, before `execute` starts
   touching contradiction-detection files, so the DDR exists before the
   false-positive-risk code is written, not as an afterthought.

## Success Criteria

- `consolidateMemories()` returns two new counts (`demoted`, `reinforced`) plus
  contradiction-pair counts (`contradictionsFlagged`, `contradictionPairsChecked`),
  alongside the existing `embedded`/`merged`/`pruned`.
- A memory with `use_count >= 5` and `helpRate < 0.3` has its `confidence` reduced
  (not below 0.1) and its `use_count`/`help_count` reset to 0 after one
  `consolidateMemories()` call; `last_verified_at` is unchanged.
- A memory with `use_count >= 5` and `helpRate > 0.8` has its `confidence`
  increased (capped at 1.0), `last_verified_at` refreshed, and counts reset.
- A memory with `use_count` between the thresholds, or below `MIN_EVALUATIONS`,
  is untouched.
- Two `'related'`-linked memories with divergent confidence/decay_class that
  Haiku confirms as conflicting produce exactly one `memory_links` row
  (`link_type='contradicts'`) and one `diagnostics` row (`type='stale'`,
  `details.reason='contradiction'`); both are visible via existing tools
  (`nexus_crossref`-style link lookup, `nexus_health` diagnostics) with zero
  changes to those tools' own code.
- Two related memories that Haiku says do NOT conflict produce no writes.
- `decay.ts` (`decayFactor`, `effectiveConfidence`, `flagStaleMemories`) is
  untouched — verified by diff, not just by intent.
- No new SQLite CHECK constraint values, no new columns, no new tables.
- A DDR exists (via `add-ddr`) covering the contradiction-detection design
  (heuristic pre-filter + Haiku confirmation + surfacing-only, never
  auto-suppress) before that code is merged, per the synthesis's explicit
  requirement.
