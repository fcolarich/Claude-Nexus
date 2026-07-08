# Implementation Spec — Promotion Classification

Anchors re-verified against repo HEAD 2026-07-08 (paths absolute in the repo `C:\Fran\claude-nexus`). Where a design line number drifted, the architecture's evidence was re-checked and the current line is used below. The spec wins on conflict; the architecture's D-001..D-008 decisions are binding and are cited per component so implementers cannot miss them.

## Verified anchors (current)

- `src/core/types.ts`: `MemoryType` at :9; `Memory` interface :44–66.
- `src/capture/extract.ts`: `MemoryCandidate` :12–20; `MEMORY_TYPES` set :25 (sibling for `PROMOTION_TARGETS`); `RESTATEMENT_RE` :46; `ADR_REF_RE` :39; `SYSTEM_PROMPT` :48–89 (`memory_type` block :52–60); `parseCandidates` :92–126 (push at :122); `refineCandidates` :134–150 (split/append :141–142); `extractMemories` :153–161.
- `src/core/memories.ts`: `MemoryInput` :12–25; `insertMemory` :63–89 — **`INSERT OR IGNORE`, no SET clause** (D-001); `embedMemory` :181–203 (delete-then-insert into `memories_vec` by rowid).
- `src/core/database.ts`: `MIGRATIONS[]` :51–60 ends at v8 `project-aliases`; `LATEST_SCHEMA_VERSION` auto-derives :62; `initializeSchema` applies version > current, records on success :81–85; `migrateCoworkSupport` :400–404 = the swallowed-`try/catch` ALTER pattern to mirror; `memories` baseline with inline CHECKs :416–442; `memories_au` UPDATE trigger :474–479 (auto-syncs FTS on body rewrite).
- `src/capture/reflector.ts`: dedup short-circuits to `touchMemory` :99–103 (D-007); `insertMemory` call site :107–119.
- `src/mcp/server.ts`: `resolveProjectFromCwd` :63; read-only list shape `nexus_sessions` :257–281; mutation-confirmation shape `nexus_set_init` :200–227; every tool returns `{ content: [{ type: 'text', text }] }`.

## Implementation approach

Vertical, spec-ordered, five pieces. Each piece is TDD: write the test that pins the behavior, then the minimal code to green it. New `promotion_target` defaults to `'none'` at every layer, so the whole change is additive and backward compatible — old JSON, old rows, and untouched call sites all read `'none'` with no special-casing.

The riskiest correctness point is the DB column: `NOT NULL DEFAULT 'none'` with an inline CHECK means existing rows auto-fill `'none'` on `ALTER ADD COLUMN` (D-002), and `insertMemory` must supply a valid value or the CHECK rejects the row. `MemoryInput.promotion_target` is therefore required (not optional) so every call site is forced to pass it — the compiler finds any site that forgot.

`nexus_mark_promoted` is the only place that mutates an already-stored, already-embedded row, so it is the only place that must re-embed (D-005): rewrite body → thin pointer → `UPDATE` (FTS auto-syncs via `memories_au`) → `embedMemory(db, id)` best-effort. The extraction/refine path never re-embeds an existing row (it rewrites before the first embed), so it is not a precedent for leaving the vector stale here.

## Build order and dependencies

1. **Piece 1 — types + extraction classification** (`types.ts`, `extract.ts`, `extract.test.ts`). Root of the graph; everything downstream imports `PromotionTarget`. Sub-order: (1a) `PromotionTarget` in types.ts; (1b) `MemoryCandidate` field + `PROMOTION_TARGETS` set + `SYSTEM_PROMPT` block; (1c) `parseCandidates` validation/default; (1d) `refineCandidates` force-none; each with its test. 1b–1d depend only on 1a.
2. **Piece 2 — schema + insert path + passthrough** (`types.ts` Memory fields, `database.ts` migration v9, `memories.ts` MemoryInput+insertMemory, `reflector.ts` passthrough). Depends on Piece 1 for the type. Sub-order: (2a) `Memory` interface fields; (2b) migration v9 + test; (2c) `MemoryInput`+`insertMemory` columns + round-trip test; (2d) reflector passthrough. 2c depends on 2a+2b; 2d depends on 2c.
3. **Piece 3 — MCP tools** (`server.ts`: `nexus_promotions`, `nexus_mark_promoted`, + tests). Depends on Piece 2 (columns must exist; `insertMemory` seeds test fixtures). The two tools are independent of each other and can be built in parallel once the shared helper query is understood — but they live in the same file, so serialize their edits.
4. **Piece 4 — OPTIONAL dashboard filter chip** (`src/web` + `src/frontend`). Lowest priority, explicitly skippable. Depends on Piece 3's query semantics only conceptually; touches only frontend + web read endpoint.
5. **Piece 5 — acceptance validation.** Depends on all of 1–3. Runs `npm test` (all ~107 existing green + new tests), asserts old-JSON-parses-none and migration idempotency at the suite level.

## Test strategy (per component)

- **types.ts** — no test. Pure type declarations; the compiler is the check. Downstream tests exercise the type.
- **extract.ts** — **unit** (`extract.test.ts`, Vitest). `parseCandidates`: each of the six targets round-trips; missing field → `'none'` (the AC-5 / old-JSON case); invalid/garbage → `'none'`. `refineCandidates`: a `decision` body matching `RESTATEMENT_RE` (≤200 chars) → emitted `reference` has `promotion_target='none'` even when input carried `'adr'`; a non-restatement candidate preserves its target. Pure functions, no model call — deterministic and cheap. The `SYSTEM_PROMPT` block itself is not unit-tested (model behavior); it is covered by acceptance step 5 (manual end-to-end) — noted as a Risk.
- **database.ts (migration v9)** — **unit** against a temp/in-memory DB. Fresh DB: `initializeSchema` → version 9 recorded, both columns present (`PRAGMA table_info`), partial index present. Idempotency (AC-6): `initializeSchema` twice = no-op (v9 skipped); directly re-invoking `migratePromotionClassification` swallows duplicate-column errors and does not throw. Pre-existing row inserted before the ALTER reads `promotion_target='none'` after migrate.
- **memories.ts (insertMemory)** — **unit** (round-trip). `insertMemory` with `promotion_target='adr'` → `getMemory` returns `promotion_target='adr'`, `promoted_to=null`.
- **reflector.ts** — **covered indirectly**; no new dedicated reflector test required. The passthrough is a one-line field add; existing reflector tests must still pass (they will need `promotion_target` on any inline `MemoryCandidate` fixtures — see Edge cases). If a reflector test constructs candidates, extend those fixtures rather than adding a new test.
- **mcp/server.ts** — **unit** against a temp DB seeded via `insertMemory`. `nexus_promotions`: returns only rows satisfying all four predicates; excludes `promoted_to` set, `review_status='rejected'`, `superseded_by` set, and `'none'`; `target` filter narrows to one group; empty → `'No promotion candidates found.'`. `nexus_mark_promoted`: sets `promoted_to`; body ends `→ <artifact_ref>`; title unchanged; `review_status` unchanged; unknown id → error text with no write; re-embed invoked (assert via injected embed fake / `memories_vec` rowid change) and tool still succeeds when embed returns false.
- **dashboard chip (optional)** — **none** if skipped. If built: a light component/render test only; not on the acceptance path.

## Edge cases and error handling (per component)

- **extract.ts** — old/invalid JSON: `o.promotion_target` missing or not in `PROMOTION_TARGETS` → `'none'` (never throw). Restatement force-none must run in `refineCandidates` (after parse) so it also overrides a model that wrongly emitted `'adr'` on a codified decision. Do not change the existing restatement gate (`memory_type==='decision' && RESTATEMENT_RE.test(body) && body.length<=200`); only add `promotion_target:'none'` to the emitted reference object.
- **database.ts** — CHECK on `ALTER ADD COLUMN` is valid in bundled better-sqlite3 (D-002); do not split into a table-recreate. Second run: ALTERs throw "duplicate column name" → swallowed by `try{}catch{}`; index is `IF NOT EXISTS`. `schema_version` is recorded only after `up` returns (framework at :81–85) — keep the migration self-contained and idempotent. **CHECK portability caveat (Risk):** a future CHANGE to the CHECK list would need a full table recreate (as `migrateCorpusExpansion` did) — acceptable now.
- **memories.ts** — `promoted_to` is deliberately NOT in the INSERT column list — it must start NULL via column default (D-001). `MemoryInput.promotion_target` is required (no `?`) so the CHECK never sees a missing value; a bad value is a caller bug surfaced by the DB CHECK, not silently coerced.
- **reflector.ts** — dedup hit path (:99–103) calls `touchMemory` only and must stay untouched (D-007): the first-stored classification wins; a later near-duplicate with a different `promotion_target` is discarded (never inserted), and an already-promoted memory keeps its pointer body + `promoted_to`. Do not add field-merge logic. Only add `promotion_target: c.promotion_target` to the `insertMemory` object at :107–119.
- **mcp/server.ts** — `nexus_promotions`: empty result returns the sentinel text, not an error. Project resolution via `resolveProjectFromCwd` only when `cwd`/`project` given; omitting both lists across all projects. `nexus_mark_promoted`: unknown id → `{ content:[{type:'text',text:'Error: ...'}] }`, no write (mirror `nexus_set_init` not-found). Body rewrite reuses the exact D-006 split/append: `firstSentence = body.split(/(?<=[.!?])\s/)[0].trim()`, then append `→ <artifact_ref>` only if `firstSentence` does not already contain it; title unchanged. Single `UPDATE memories SET body=?, promoted_to=?, updated_at=datetime('now') WHERE id=?` — FTS auto-syncs via `memories_au`. Re-embed is best-effort (D-005): if `embedMemory` returns false (embeddings unavailable) the tool still reports success — the body/pointer write is load-bearing. `review_status` and recall are never written (D-008).
- **Existing reflector/other tests** — any test or fixture that builds a `MemoryCandidate` or `MemoryInput` literal will fail to compile until `promotion_target` is added. Grep those fixtures during Piece 2 and add `promotion_target:'none'`. This is expected fallout of making the field required and is part of keeping the ~107 green (AC-4).

## Acceptance → task coverage matrix

| Acceptance Criterion | Covered by |
|---|---|
| AC-1: unformalized decision → `promotion_target='ddr'\|'adr'`, listed by `nexus_promotions` | task-003 (SYSTEM_PROMPT classification block), task-011 (nexus_promotions query/list), task-015 (acceptance validation, incl. manual end-to-end for model behavior) |
| AC-2: restating ADR-051 → reference memory with `promotion_target='none'` | task-005 (refineCandidates force-none + test), task-015 |
| AC-3: `nexus_mark_promoted(id,'ADR-063')` → body ends `→ ADR-063` | task-012 (nexus_mark_promoted rewrite + re-embed), task-013 (assert), task-015 |
| AC-4: all ~107 existing tests pass (`npm test`) | task-004, task-007, task-009, task-010 (fixture updates), task-013, task-015 |
| AC-5: old extraction JSON without field parses as `'none'` | task-004 (parseCandidates default-none test), task-015 |
| AC-6: migration idempotent — re-open is a no-op | task-006 (migration), task-007 (idempotency test), task-015 |
