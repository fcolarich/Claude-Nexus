# Design — Promotion Classification

**Source:** `docs/Claude Nexus - Promotion Classification Spec.md` (approved 2026-07-07; rationale recorded as ADR-060 in `C:\Fran\LLM_Workflow_Optimization\_documents\decisions\`). This design transcribes that spec; on any conflict, the spec wins.

## Problem

SessionEnd auto-extraction flattens everything durable into generic memories in nexus.db. Some extractions are really candidates for typed curated artifacts — ADRs, DDRs, Unity best practices, recipes, project notes — which live in append-only, human-approved stores written via per-file skills (`/add-adr`, `/add-ddr`, `/add-best-practice`, `/add-recipe`, `/add-note`). Nothing routes a memory toward promotion, so durable knowledge stays trapped in generic memories and the artifact stores only grow when a human remembers to invoke a skill mid-session.

## Goals

- Every extracted memory carries a `promotion_target` classification: `none | adr | ddr | best_practice | recipe | note`.
- `nexus_promotions(project?, target?)` MCP tool lists unpromoted, unrejected, unsuperseded candidates grouped by target.
- `nexus_mark_promoted(id, artifact_ref)` closes the loop: sets `promoted_to` and rewrites the memory body to thin-pointer form (one-line gist + `→ <artifact_ref>`), matching the shape `refineCandidates()` already produces for codified decisions.
- Backward compatible: old extraction JSON without the field parses as `promotion_target='none'`; all ~107 existing tests keep passing.
- Classification is conservative: restatements of existing ADRs/DDRs are forced to `'none'`.

## Non-goals (binding scope cap)

- NO auto-writing of ADR/DDR/BP/recipe/note files from any hook. The hook classifies only; promotion stays manual and skill-driven.
- NO new artifact stores in nexus.db — artifacts live where they live today.
- NO changes to `review_status` semantics (promotion review is orthogonal; a rejected memory is never a promotion candidate).
- NO changes to recall/injection behavior. (`promotion_target`/`promoted_to` may appear in exported frontmatter, but recall is untouched.)

## Constraints

- Tech stack locked: TypeScript ESM (Node 22+), better-sqlite3, Vitest. Tabs for indentation. Flat codebase conventions per CLAUDE.md.
- Migration must follow the repo's existing idempotent, column-existence-guarded pattern in `src/core/database.ts`.
- SYSTEM_PROMPT classification block must be added exactly as drafted in the spec (§1).
- Spec line anchors verified 2026-07-08: `MemoryCandidate` at extract.ts:12, `RESTATEMENT_RE` at :46, `SYSTEM_PROMPT` at :48, `parseCandidates` at :92, `refineCandidates` at :134. Re-verify before editing if drifted.
- Dashboard filter chip (piece 4) is optional, lowest priority — skip if effort balloons.

## Proposed Approach

**Classify-and-promote, never auto-write** (selected in the approved spec; the alternative — auto-writing artifacts from the SessionEnd hook — was explicitly rejected because Haiku extraction is unreviewed and the artifact stores' trustworthiness comes from human curation).

Five ordered pieces:

1. **Extraction classification** — `src/core/types.ts`: add `PromotionTarget = 'none' | 'adr' | 'ddr' | 'best_practice' | 'recipe' | 'note'` next to `MemoryType`. `src/capture/extract.ts`: add `promotion_target: PromotionTarget` to `MemoryCandidate`; add the spec's classification block to `SYSTEM_PROMPT` after the `memory_type` block; `parseCandidates()` validates against a `PROMOTION_TARGETS` set defaulting `'none'`; `refineCandidates()` forces `'none'` for bodies matching `RESTATEMENT_RE`. Tests in `src/capture/extract.test.ts`: classification parse, default-none fallback on missing/invalid, restatement force-none.
2. **Schema** — `src/core/database.ts`: idempotent migration adding `memories.promotion_target` (TEXT NOT NULL DEFAULT 'none' with CHECK on the six values) and `memories.promoted_to` (TEXT NULL), plus partial index `idx_memories_promotion ON memories(promotion_target) WHERE promotion_target != 'none'`. Pass `promotion_target` through the memory INSERT path in `src/capture/` (locate at implementation time); `promoted_to` starts NULL. Remember repo convention: `INSERT ... ON CONFLICT DO UPDATE` must include all fields in the SET clause. Tests: migration idempotency + insert round-trip.
3. **Review surface & loop closure** — `src/mcp/server.ts`: `nexus_promotions(project?, target?)` (read-only; WHERE `promotion_target != 'none' AND promoted_to IS NULL AND review_status != 'rejected' AND superseded_by IS NULL`; grouped by target; each row with id/title/body/confidence/source_session_id) and `nexus_mark_promoted(id, artifact_ref)` (sets `promoted_to`, rewrites body to one-line gist + `→ <artifact_ref>`). Tests for both.
4. **(Optional)** web dashboard "promotion candidates" filter chip.
5. **Acceptance validation** — see Success Criteria.

Automatic backstop already exists: the extraction restatement rule collapses codified decisions into reference memories in later sessions, so unmarked promotions eventually become pointers anyway; `nexus_mark_promoted` just makes it immediate.

## Key Questions (for architect)

- Where exactly is the memory INSERT in `src/capture/` (reflector.ts?), and does it use `ON CONFLICT DO UPDATE`? If so, `promotion_target` must be added to the SET clause per repo convention.
- What does the existing migration guard pattern in `database.ts` look like (PRAGMA table_info column check?) — follow it exactly, including `schema_version` handling if used.
- How do existing MCP tools in `src/mcp/server.ts` shape their responses — match that shape for `nexus_promotions`/`nexus_mark_promoted`.
- Does `nexus_mark_promoted`'s body rewrite need to re-embed the memory (embeddings pipeline) or leave the vector stale? Check how the existing restatement/refine path handles it and mirror.
- Does the dedup-merge in reflector.ts overwrite `promotion_target` on merge? Define behavior (spec is silent — keep the more specific/non-none value or latest?).

## Success Criteria

- A session containing an unformalized design decision yields a memory with `promotion_target='ddr'|'adr'`, and `nexus_promotions` lists it.
- A session restating an existing ADR (e.g. ADR-051) yields a reference memory with `promotion_target='none'`.
- `nexus_mark_promoted(id, 'ADR-063')` leaves a thin pointer whose body ends in `→ ADR-063`.
- All existing extract/database tests still pass (`npm test`).
- Old extraction JSON without the field parses with `promotion_target='none'`.
- Migration is idempotent: opening an already-migrated DB is a no-op.
