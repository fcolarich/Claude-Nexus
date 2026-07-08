# Claude Nexus — Promotion Classification Spec

**Status:** Proposed (design approved in LLM_Workflow_Optimization session 2026-07-07; independent of the Uber Database — implementable immediately)
**Related:** `C:\Fran\LLM_Workflow_Optimization\_documents\Uber Database SPEC.md` § "Claude Nexus Boundary & Knowledge Promotion"

## Problem

SessionEnd auto-extraction flattens everything durable into generic memories. Some of those extractions are really *candidates for typed artifacts* — ADRs, DDRs, Unity best practices, recipes, project notes — which live in curated, append-only, human-approved stores written via per-file skills (`/add-adr`, `/add-ddr`, `/add-best-practice`, `/add-recipe`, `/add-note`). Today nothing routes a memory toward promotion; durable knowledge stays trapped in nexus.db, and the artifact stores only grow when a human remembers to invoke a skill mid-session.

Auto-writing artifacts from the hook is explicitly rejected: Haiku extraction is unreviewed, and the artifact stores' trustworthiness comes from curation (numbering, dedup, citations). The design: **classify at extraction, promote via human-gated skills, close the loop with the existing restatement machinery.**

## Design

### 1. `promotion_target` on extraction

`src/capture/extract.ts`:

- `MemoryCandidate` (lines 12–20) gains `promotion_target: PromotionTarget` where `PromotionTarget = 'none' | 'adr' | 'ddr' | 'best_practice' | 'recipe' | 'note'` (add the type to `src/core/types.ts` next to `MemoryType`).
- `SYSTEM_PROMPT` (lines 48–89) gains a classification block after the `memory_type` block:

```
promotion_target — should this memory graduate into a curated artifact? pick one:
- adr           — a structural/technical decision with rationale that is NOT yet recorded as an ADR (if already recorded, the existing rules emit a reference memory instead)
- ddr           — a design decision (UX, API shape, data model, naming, game mechanic) not yet recorded as a DDR
- best_practice — a reusable, citation-backable technique that applies across projects (typically Unity/engine domain)
- recipe        — a worked example solving a recurring problem, grounded in real project code
- note          — a project-specific gotcha, spike result, or open question worth a durable note
- none          — everything else (preferences, corrections, tool quirks, session state). DEFAULT — when unsure, use none.

Rules:
- promotion_target is INDEPENDENT of memory_type (a "decision" memory that is already ADR-recorded gets none; an "insight" may still be best_practice material).
- Be conservative: a promotion candidate creates human review work. Only flag entries a maintainer would plausibly formalize.
- Never flag session-progress narration, restatements of existing ADRs/DDRs, or facts derivable from the code.
```

- `parseCandidates()` (lines 92–126): validate against a `PROMOTION_TARGETS` set; default `'none'` when missing/invalid (backward compatible — old prompts/responses still parse).
- `refineCandidates()`: entries whose body matches `RESTATEMENT_RE` (line 46, already-codified decisions) are forced to `promotion_target='none'` — they become thin reference memories via the existing path and must not re-enter review.

### 2. Schema

`src/core/database.ts` (memories table, review_status at line 436):

```sql
ALTER TABLE memories ADD COLUMN promotion_target TEXT NOT NULL DEFAULT 'none'
  CHECK(promotion_target IN ('none','adr','ddr','best_practice','recipe','note'));
ALTER TABLE memories ADD COLUMN promoted_to TEXT;  -- artifact ref once promoted, e.g. 'ADR-063', 'BP-shaders-012', or a file path
CREATE INDEX IF NOT EXISTS idx_memories_promotion ON memories(promotion_target) WHERE promotion_target != 'none';
```

Follow the existing migration pattern in `database.ts` (idempotent `ALTER`/`CREATE IF NOT EXISTS` guarded by column-existence check, as done for prior added columns). Insert path: pass `promotion_target` through wherever `MemoryCandidate` fields are written (locate the INSERT in `src/capture/` at implementation time); `promoted_to` starts NULL.

### 3. Review surface

Two additions, both thin:

- **MCP tool `nexus_promotions(project?, target?)`** (`src/mcp/server.ts`): lists memories where `promotion_target != 'none' AND promoted_to IS NULL AND review_status != 'rejected' AND superseded_by IS NULL`, grouped by target, each with id/title/body/confidence/source_session_id. Read-only.
- **Web dashboard filter** (`src/web` + `src/frontend`): the memories view gains a "promotion candidates" filter chip on the same column. (Optional in v1 — the MCP tool is the functional minimum.)

### 4. Promotion & loop closure

Promotion itself stays manual and skill-driven — the human runs `/add-adr` (etc.) in the relevant project, the skill writes the `.md` and rebuilds indexes. Closure has two paths:

- **Explicit:** new MCP tool `nexus_mark_promoted(id, artifact_ref)` sets `promoted_to`, then rewrites the memory to the thin-pointer form (title kept; body → one-line gist + `→ <artifact_ref>`) matching the shape `refineCandidates()` already produces for codified decisions. One update, no new concepts.
- **Automatic backstop:** the existing extraction rule already converts decisions it sees codified (`RESTATEMENT_RE` / "Existing canonical decisions" list) into reference memories in later sessions — so even unmarked promotions eventually collapse to pointers. `nexus_mark_promoted` just makes it immediate.

### 5. What deliberately does NOT change

- No auto-writing of ADR/DDR/BP files from any hook.
- No new artifact stores in nexus.db — artifacts live where they live today.
- `review_status` semantics untouched (promotion review is orthogonal to memory approval; a rejected memory is never a promotion candidate).
- Export format: `promotion_target`/`promoted_to` may be added to exported frontmatter but recall/injection behavior is unchanged.

## Implementation order

1. `types.ts` + `extract.ts` (prompt, parse, refine) + tests in `extract.test.ts` (classification parse, default-none fallback, restatement force-none)
2. `database.ts` migration + insert path + tests
3. `nexus_promotions` + `nexus_mark_promoted` MCP tools + tests
4. (Optional) dashboard filter chip
5. Run one real session end-to-end; check candidate precision — if the hook over-flags, tighten the "be conservative" prompt rules before adding any UI

## Acceptance

- A session containing an unformalized design decision yields a memory with `promotion_target='ddr'|'adr'`; `nexus_promotions` lists it.
- A session restating ADR-051 yields a reference memory with `promotion_target='none'`.
- `nexus_mark_promoted(id, 'ADR-063')` leaves a thin pointer whose body ends in `→ ADR-063`.
- All existing extract/database tests still pass; old extraction JSON without the field parses with `promotion_target='none'`.
