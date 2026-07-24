# Design — Capture/Recall Hardening

Source: `_documents/research/claude-nexus-improvements-synthesis.md`, items 2–5, 8 (of that
doc's numbering). Deferred to future `/tdd` runs: item 6 (help-rate-trend promotion/demotion)
and item 7 (contradiction/staleness detection) — the synthesis itself flags item 7 as needing
its own DDR before implementation, and item 6 is an independent, medium-effort axis better
scoped on its own.

## Problem

Five verified, low/medium-risk gaps exist in Nexus's capture and recall pipeline, each
confirmed directly against current source (not inferred):

1. **`recall.ts`'s `estTokens`** (`Math.ceil(s.length / 4)`) is a flat chars-per-token
   heuristic used to walk the 2000-token recall budget — misestimates cost for code
   snippets, ADR citations, and non-English text, causing premature elision or overrun.
2. **The 18(+)-tool MCP surface** has never been audited against actual usage/grouping
   patterns since ADR-011 (the last deliberate consolidation move).
3. **Capture/consolidation is a subset of the intended pattern.** Confirmed by reading
   `consolidate.ts`, `extract.ts`, `export.ts`:
   - `consolidateMemories()` does embed-backfill + prune-rejected + merge-duplicate-by-supersede.
     There is no "rewrite" step (LLM-based summarization/compaction of surviving memories).
   - `refineCandidates()` in `extract.ts` only drops candidates matching `COMPLETION_RE`
     (post-hoc narration filtering on Haiku's output) — there is no pre-LLM per-candidate
     signal-scoring rubric before the extraction call is made.
   - `exportAll()` in `export.ts` writes one `MEMORY.md` index per project bucket with **no
     line/byte cap** — it lists every approved memory's title + first-line hook, unbounded,
     and this file is auto-loaded in full by Claude Code's native auto-memory feature.
4. **`recallByQuery()` in `recall.ts`** (backs the per-prompt `UserPromptSubmit` hook) uses a
   vector-KNN-then-FTS5-fallback strategy — it does not fuse FTS5 and vector results with RRF
   the way `hybridSearchMemories()` in `search.ts` already does for `nexus_search`. A strong
   vector match can currently suppress a keyword-exact FTS5 hit even when both signals exist.
5. **The cross-encoder reranker** (ADR-012, `jina-reranker-v2-base-multilingual`) is fully
   built and wired into `recallByQuery()`, but its code-baked default in `config.ts` is
   `enabled: false` (confirmed at `config.ts:94`) — so a fresh install / new machine never
   gets reranked recall unless someone manually edits `extraction_models.yaml`.

## Goals

- `recall.ts` token-budget estimation reflects real token counts (within a reasonable
  tolerance) instead of a flat 4-chars/token guess, for both full-body and title-only walks.
- A written audit exists (as a project note) covering the current MCP tool count, what each
  tool does, and any concrete grouping/consolidation candidates — informing but not forcing a
  redesign.
- `consolidateMemories()`'s scope is explicitly confirmed against the "merge+prune+rewrite"
  pattern; if a rewrite step is added, it is scoped minimally (no new schema).
- `exportAll()`'s `MEMORY.md` index is capped (line or byte ceiling) with graceful
  truncation-with-pointer behavior instead of unbounded growth.
- `recallByQuery()` fuses FTS5 + vector candidates via the same RRF mechanism
  `hybridSearchMemories()` already uses, while preserving its existing per-prompt-specific
  behavior (min-similarity floor, `excludeIds` dedup, `load_at_init` handling N/A here,
  optional reranker pass).
- The reranker is enabled by default in `config.ts`'s baked-in `DEFAULTS`, with its
  50–100ms latency figure re-validated at per-prompt call frequency (not just per-session).

## Non-goals

- Help-rate-trend-based promotion/demotion (synthesis item 6) — deferred to a future session.
- Contradiction/staleness detection beyond ADR-pointer normalization (synthesis item 7) —
  deferred; synthesis explicitly recommends its own DDR first.
- Secret-redaction guard (synthesis item 1) — not requested in this batch.
- Non-git project-slug fallback fix (synthesis item 10) — not requested in this batch.
- Any MCP tool surface *changes* — this batch only produces the audit/report, not a
  consolidation implementation (per synthesis: "audit only, no code change to start").
- Reranker model upgrade (v2 → v3) — noted in synthesis as worth evaluating separately, not
  bundled into "enable by default."
- New database schema/migrations — all five items are additive against existing tables/config.

## Constraints

- No fixed deadline, no additional scope caps.
- Tech stack is otherwise unconstrained — a new npm dependency (e.g. a tokenizer package) is
  allowed if it's the right tool for item 1, but prefer something already dependency-light and
  consistent with "flat codebase, minimal abstraction."
- Must not touch schema/migrations (see Non-goals).
- Existing test suites (`recall.test.ts`, `search.ts`-adjacent tests, `export.test.ts`,
  `extract.test.ts`) must continue to pass; new behavior gets new/extended tests in the same
  files per TDD convention.

## Proposed Approach

**Sequential single branch**, one feature branch, tasks ordered safest/most-isolated first so
each item can be verified independently before the next lands on top of it:

1. **Tokenizer swap** (`recall.ts` `estTokens`) — smallest blast radius, single function,
   already has direct callers exercised by `recall.test.ts`.
2. **MCP tool surface audit** — read-only research task, writes a project note
   (`shared-skills:add-note` or `add-reference`), zero production code risk. No dependency on
   the other items.
3. **Capture/consolidation hardening** — three sub-parts, each independently testable:
   a. Confirm/extend `consolidateMemories()` scope (rewrite step, scoped minimally, only if the
      audit in step (b)/(c) below shows the "merge+prune" subset is insufficient — this task
      starts with confirming current scope against the four-source-converged pattern from the
      synthesis, and only adds code if a real gap remains after confirmation).
   b. Pre-LLM signal-scoring filter in the capture path (reflector.ts's observer gate currently
      gates the whole extraction call — evaluate whether per-candidate scoring before the Haiku
      call is warranted, or whether `refineCandidates`'s existing post-hoc narration filter
      already covers the practical case).
   c. Size-cap `exportAll()`'s per-bucket `MEMORY.md` index (line/byte ceiling from
      `extraction_models.yaml capture` config, truncate-with-pointer-to-nexus_search on
      overflow, mirroring the existing `recall.ts` title-elision pattern).
4. **RRF reuse in `recallByQuery()`** — the highest-touch item since it changes the live
   per-prompt recall path's ranking behavior; land after 1–3 are verified stable so a
   regression here is easy to isolate. Extract the RRF fusion math (`RRF_K = 60`, position-based
   fusion) from `search.ts` into a small shared helper both `hybridSearchMemories()` and
   `recallByQuery()` call, rather than having `recallByQuery()` call `hybridSearchMemories()`
   directly (which lacks `excludeIds`, `minSimilarity` floor, and reranker-pass support that
   `recallByQuery()` needs) — architect to confirm this shape.
5. **Reranker enabled by default** — smallest diff (one boolean flip in `config.ts`
   `DEFAULTS.reranker.enabled`) but land last since it changes default behavior for every
   fresh install and compounds with item 4's ranking change; want 1–4 proven first. Re-verify
   the 50–100ms latency claim holds at per-prompt frequency (add a quick timing note/log check,
   not a formal benchmark harness) before flipping the default.

**Trade-off accepted:** a regression in an early item (e.g. tokenizer) blocks work on later
items until fixed, since they share one branch. Given all five are small, well-isolated changes
with existing test coverage nearby, this is judged lower risk than the coordination overhead of
five separate branches/PRs.

## Key Questions

For the architect to resolve in `architecture.md`:

1. **Tokenizer choice** — which library/approach for item 1? Candidates: a small BPE
   approximation matching Claude's tokenizer family (no exact public tokenizer for Claude
   models is guaranteed stable), a general-purpose tiktoken-style estimator, or a documented
   improved heuristic (e.g. word-count-based with code-block detection) if pulling in a real
   tokenizer dependency is judged disproportionate to the gain. Needs an explicit trade-off
   note in architecture.md.
2. **RRF extraction shape** — should the shared RRF helper operate on raw `(id, fts_rank,
   vec_rank)` tuples generic to both atoms and memories, or should it be memories-specific
   (matching `hybridSearchMemories`'s existing shape) with `hybridSearch` (atoms) left
   unchanged? Given "flat codebase, minimal abstraction," lean toward the smaller memories-only
   extraction unless atoms-side reuse is trivial.
3. **`recallByQuery()` candidate pool size** — today it pulls `limit * 6` vector candidates
   before flooring. Once FTS5 candidates are fused in via RRF, does the FTS5 side need a
   matching pool size (e.g. `limit * 3`, matching its existing fallback path), and does the
   reranker pass then run over the fused set or only the vector subset as before?
4. **Consolidation "rewrite" step scope** — is a rewrite step (LLM-based memory-body
   compaction) actually justified for this project's current memory volume, or does the
   embed+prune+merge subset already satisfy the practical need? Architect should make a
   go/no-go call with reasoning, not default to building it.
5. **MEMORY.md cap unit and threshold** — line count, byte size, or both? What's a sane
   default (e.g. cap titles shown per bucket, similar to `recall.ts`'s `max_title_items`
   pattern) and where does it live in `extraction_models.yaml capture`?
6. **MCP audit deliverable format** — a `_documents/notes/note-NNN-*.md` via `add-note`, or
   `_documents/references/ref-NNN-*.md` via `add-reference`? Note fits better (project-specific
   finding, mutable) — architect to confirm and specify exact skill invocation in the task plan.

## Success Criteria

- `recall.test.ts` (extended) shows the new token estimator's error margin against real
  Claude-tokenizer counts is meaningfully tighter than the flat 4-chars/token heuristic on a
  sample of code-snippet and prose memory bodies.
- A note/reference document exists summarizing the MCP tool audit: tool count, grouping
  candidates (if any), and an explicit recommendation (consolidate now / revisit later / no
  action) — reviewable independent of any code change.
- `consolidateMemories()`'s behavior against the merge+prune+rewrite pattern is explicitly
  documented (in code comments and/or architecture.md) as either "rewrite added, scoped as
  X" or "rewrite not warranted, because Y" — not left ambiguous.
- `exportAll()` never writes a `MEMORY.md` index past the configured cap; existing
  `export.test.ts` gains a case asserting truncation behavior with a large synthetic memory set.
- `recallByQuery()` returns fused FTS5+vector results (verified via a test case where a
  keyword-exact FTS5 match currently gets excluded by a stronger cosine match, and after the
  change the FTS5 match appears in the fused top-N).
- `getNexusConfig().reranker.enabled` defaults to `true` when `extraction_models.yaml` has no
  `reranker.enabled` key set (unit test on `config.ts` defaults), and a latency spot-check
  confirms the 50–100ms figure still holds at per-prompt call frequency.
- All five changes ship on one branch; existing test suites remain green throughout, with new
  tests added per item rather than modified to accommodate weaker assertions.
