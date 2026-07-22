# Implementation Spec — Promotion/Demotion & Staleness Detection

## Implementation approach

Build the two passes as standalone functions in a new `src/core/governance.ts`, then
wire them into `consolidateMemories()` as phases 4 and 5. `consolidate.ts` stays an
orchestrator — no governance/contradiction logic inlined.

TDD per function against an in-memory `better-sqlite3` DB seeded via the schema in
`database.ts`. Phase 5 uses an **injected fake `HaikuFn`** (a recording/canned-return
stub) so tests are deterministic and cost nothing — no real model call ever runs in a
test. Phase 4 is pure SQL and needs no injection.

Constraint discipline (design `## Constraints`, no D-### IDs — so `constraints: []` on
every task; the rules are embedded in task descriptions instead):
- **No schema changes** — only existing columns/CHECK values (`memory_links.link_type='contradicts'`,
  `diagnostics.type='stale'`) are written. No migration task exists.
- **Never open `src/core/decay.ts`** — it appears in *zero* task file lists. This is the
  structural enforcement of the "decay.ts untouched" success criterion; the self-heal
  test proves resilience to its `DELETE FROM diagnostics WHERE type='stale'` without
  editing it.
- **Surfacing-only** — no delete/hide/supersede in either pass.
- **Folded into `nexus_consolidate`** — no new MCP tool.

Two doc discrepancies resolved toward the architecture (later, more detailed doc):
1. **Rows per confirmed pair.** design Success Criteria says "exactly one `memory_links`
   row"; architecture Storage/Data-Flow writes **two** (both directions) for symmetric
   `nexus_crossref` lookup. **Follow the architecture — write both directions.** The
   single-logical-relationship intent of the criterion is preserved; the write test
   asserts two directional rows + exactly one diagnostic. This deviation is one of the
   items the contradiction-detection DDR must record.
2. **`contradictionPairsChecked` semantics.** Defined as *shortlisted pairs sent to
   `haikuFn` this run* (attempted), regardless of outcome — a throw/parse-failure still
   counts as checked but yields no flag. `contradictionsFlagged` counts only pairs
   confirmed `conflict=true` that produced a fresh write.

`callModel` (`src/core/llm.ts`) is reused verbatim as the default `HaikuFn` in both
`governance.ts` and `consolidate.ts`; it is never modified.

## Build order & dependencies (per component)

1. **`governance.ts` scaffold** — constants, `GovernResult`/`ContradictionResult`/`HaikuFn`
   exports, `governByHelpRate` stub. Foundation for every other governance task. Depends on
   nothing.
2. **Contradiction DDR** (`add-ddr`) — authored right after planning, in parallel with the
   scaffold. **Hard pre-merge gate (architecture KQ4):** must land before any code touches
   `detectContradictions` or its `consolidate.ts` call site. Enforced by `depends_on`.
3. **Phase 4 (help-rate governance)** — govern tests → govern impl → wire into
   `consolidate.ts`. No DDR gate (pure arithmetic, no false-positive risk).
4. **Phase 5 (contradiction detection)** — all behind the DDR: `detectContradictions` stub →
   selection tests → selection impl → write tests → write impl → self-heal tests →
   self-heal impl → wire call site into `consolidate.ts`.
5. **MCP output** — extend `nexus_consolidate` report text. Depends on the full
   `ConsolidateResult`.
6. **End-to-end integration test** — after both phases are wired.

Component dependency edges:
- `governance.ts` → `database.ts` (schema/columns), `llm.ts` (default `HaikuFn`).
- `consolidate.ts` → `governance.ts` (imports both phase functions).
- `mcp/server.ts` → `consolidate.ts` (`ConsolidateResult` shape).
- Both phases share `governance.ts`, so their impl tasks serialize on that file even where
  no dependency edge exists; test files are split (`governance-helprate.test.ts` vs
  `governance-contradictions.test.ts`) to keep test-writing parallel to the other phase's
  impl.

## Test strategy (per component)

- **`governByHelpRate` — unit.** Pure SQL over seeded rows. Assert every branch
  (demote / reinforce / dead-zone / below-`MIN_EVALUATIONS`), floor/cap clamps, count reset
  on all branches, `last_verified_at` refreshed **only** on reinforce, `updated_at` always
  set. Deterministic, no network — unit fully covers it; no integration needed.
- **`detectContradictions` — unit with injected fake `HaikuFn`.** A recording fake asserts
  the shortlist contract (divergence pre-filter, same scope/project, approved &
  non-superseded, `NOT EXISTS` contradicts exclusion, `ORDER BY related.created_at ASC`,
  `LIMIT MAX_PAIRS_PER_RUN`). Canned string returns drive parse/write/skip branches; a fake
  that *throws* asserts skip-silently (no write, no crash). Self-heal asserted by
  pre-seeding an orphan `contradicts` link and confirming a diagnostic is re-derived.
  No real Haiku — determinism + zero cost; unit is the right level.
- **`consolidate.ts` wiring — integration.** One `consolidateMemories()` run with fake
  `embedFn` + fake `haikuFn` asserts phase order (backfill → prune → merge → govern →
  detect), aggregated counts, self-heal after a simulated `DELETE FROM diagnostics WHERE
  type='stale'`, and no schema drift (no new tables/columns/CHECK values). Integration, not
  unit, because the value is the cross-phase sequencing and count aggregation.
- **`mcp/server.ts` — none (beyond the integration test's result object).** Pure string
  formatting of an already-tested result; a dedicated test would assert string literals for
  little value.
- **DDR — none.** Documentation artifact; the `add-ddr` skill validates and rebuilds the
  index.

## Edge cases & error handling (per component)

### governByHelpRate
- `use_count == MIN_EVALUATIONS` is evaluated (`>=`), not skipped.
- `use_count >= 5` guarantees no divide-by-zero on `help_count / use_count`.
- `confidence` already at floor (demote) or 1.0 (reinforce) → clamp is a no-op change, but
  counts still reset (window consumed).
- Dead-zone rows (between thresholds) **must** reset counts + `updated_at` — do not skip
  them; skipping would turn the trend signal back into a lifetime average.
- Demote **must not** touch `last_verified_at` — doing so would restart the decay grace
  period; only reinforce refreshes it (implicit reconfirmation, mirroring `touchMemory`).

### detectContradictions
- `haikuFn` throws / times out / returns non-JSON or unparseable → treat as "couldn't
  check": skip, no write, do **not** increment `contradictionsFlagged` (still counted in
  `contradictionPairsChecked`). "Couldn't check" is never "contradiction."
- `conflict=false` → no write.
- Pair already carrying a `contradicts` link (either direction) → excluded from the
  shortlist, so confirmed pairs never re-cost Haiku.
- Idempotency: `INSERT OR IGNORE` on `UNIQUE(source_id,target_id,link_type)` for both
  directional rows; diagnostic insert guarded by an existence check → re-running
  `consolidate` produces no duplicates.
- Self-heal is idempotent and only inserts diagnostics missing for an existing
  `contradicts` link — repairs rows wiped by `decay.ts:flagStaleMemories` between runs
  without editing `decay.ts`.
- Backlog > `MAX_PAIRS_PER_RUN` drains oldest-first via `ORDER BY related.created_at ASC`
  over successive runs (KQ3: repeat cost for still-unflagged pairs is accepted; revisit
  trigger = cap saturating across consecutive runs → future minimal-schema follow-up).
- Same-scope + same-project pairs only — never cross-project.

### consolidate.ts
- `embedFn`/`haikuFn` are optional with real defaults — existing callers are unaffected
  (additive, backward-compatible signature and result fields).
- A phase-5 failure must not roll back phases 1–4's committed work; phases are independent.
