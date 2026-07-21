# Architecture: Capture/Recall Hardening

Five independent, additive hardening changes to Nexus's capture/recall pipeline. No new
schema, no migrations. Ships on one sequential branch, ordered safest-first. Each component
below maps to one design item and is verifiable in isolation.

## Components

### TokenEstimator (`recall.ts` — `estTokens`)
**Responsibility:** Estimate the token cost of a candidate memory string for the recall
budget walk, using a real BPE tokenizer instead of a flat 4-chars/token guess.
**Interface:**
```
# recall.ts — signature unchanged, callers untouched
function estTokens(s: string): number   # now BPE-backed, with heuristic fallback

# internal (module-private)
import { encode } from "gpt-tokenizer"   # cl100k_base, pure-JS, no native/WASM build
const _cache = new Map<string, number>() # memoize by body/title string within a walk
# on encode() throw -> fall back to Math.ceil(s.length / 4)
```

### RrfFuse (new — `src/core/rrf.ts`)
**Responsibility:** Pure reciprocal-rank-fusion over any set of ranked id lists; owns the
`RRF_K = 60` constant and the fusion math, nothing else.
**Interface:**
```
# src/core/rrf.ts — generic, storage-agnostic, no DB/embedding imports
export const RRF_K = 60

# each input is an ordered array of ids (best-ranked first); a missing id in a
# list contributes 0 from that list. Returns ids sorted by fused score desc.
export function rrfFuse(rankedLists: number[][], k = RRF_K): Array<{ id: number; score: number }>
```

### HybridSearchMemories (`search.ts`)
**Responsibility:** Existing `nexus_search` hybrid retrieval — refactored to delegate fusion
to `rrfFuse` instead of its inlined RRF loop; external behavior and signature unchanged.
**Interface:**
```
# search.ts — public signature unchanged
function hybridSearchMemories(query: string, opts: {...}): MemoryRow[]
#   internally: build ftsRankedIds[] + vecRankedIds[] -> rrfFuse([fts, vec]) -> hydrate
# NOTE: atoms-side hybridSearch() is intentionally NOT refactored (see Decisions)
```

### RecallByQuery (`recall.ts`)
**Responsibility:** Per-prompt `UserPromptSubmit` recall — now fuses FTS5 + vector candidates
via `rrfFuse`, preserving its min-similarity floor, `excludeIds` dedup, and reranker pass.
**Interface:**
```
# recall.ts — public signature unchanged
async function recallByQuery(query: string, opts: {
    limit: number
    excludeIds: number[]
    minSimilarity: number
}): Promise<RecallResult[]>
#   vector pool:  limit * 6   (unchanged)
#   fts5 pool:    limit * 3   (matches existing fallback-path sizing)
#   fuse:         rrfFuse([ftsIds, vecIds]) -> apply excludeIds -> apply minSimilarity floor
#   rerank:       run over the fused candidate set (bounded), not the vector subset only
```

### ExportMemoryIndex (`export.ts` — `exportAll`)
**Responsibility:** Cap each per-bucket `MEMORY.md` index at a configured item count with
graceful truncation-and-pointer, instead of writing an unbounded auto-loaded index.
**Interface:**
```
# export.ts — public signature unchanged
async function exportAll(...): Promise<void>
#   per bucket: order approved memories by decay rank (desc), keep top N
#   N = config.capture.memory_md_max_items (default 200)
#   on overflow append a single pointer line:
#     "> … {remaining} more memories — use nexus_search to retrieve them."
```

### ConsolidateMemories (`consolidate.ts`) — decision-only
**Responsibility:** Unchanged runtime behavior (embed-backfill + prune-rejected +
merge-duplicate-by-supersede); this component's deliverable is a documented go/no-go on a
rewrite step, not new code.
**Interface:**
```
# consolidate.ts — NO behavioral change; add a header comment recording the decision:
#   "Rewrite (LLM body-compaction) step evaluated and declined — see architecture.md
#    Decisions. embed+prune+merge is sufficient at current per-bucket volume; downstream
#    index bloat is handled by the MEMORY.md cap in export.ts, not by rewriting bodies."
async function consolidateMemories(...): Promise<...>   # signature + behavior unchanged
```

### ConfigDefaults (`config.ts`)
**Responsibility:** Own the baked-in `DEFAULTS`; flip reranker on so a fresh install gets
reranked recall without editing `extraction_models.yaml`.
**Interface:**
```
# config.ts — DEFAULTS only; getNexusConfig() merge logic unchanged
DEFAULTS.reranker.enabled = true          # was false at config.ts:94
DEFAULTS.capture.memory_md_max_items = 200 # new key consumed by export.ts
# getNexusConfig().reranker.enabled === true when yaml omits the key
```

### McpAuditNote (deliverable, no production code)
**Responsibility:** A mutable project note documenting the current MCP tool count, per-tool
purpose, grouping candidates, and an explicit recommendation.
**Interface:**
```
# Written via the `add-note` skill -> _documents/notes/note-NNN-mcp-tool-surface-audit.md
# Skill call: add-note  (rebuilds _documents/notes.md index via scripts/rebuild_index.py)
# Contents: tool count since ADR-011, one line per tool, grouping candidates (if any),
#           recommendation ∈ { consolidate now | revisit later | no action }
```

---

## Data Flow

### Per-prompt recall (UserPromptSubmit hook)
1. `prompt-runner` embeds the prompt and calls `recallByQuery(query, {limit, excludeIds, minSimilarity})`
2. `recallByQuery` pulls vector candidates (`limit*6`) and FTS5 candidates (`limit*3`)
3. `recallByQuery` calls `rrfFuse([ftsIds, vecIds])` → single fused ranking
4. `recallByQuery` drops `excludeIds`, applies `minSimilarity` floor to the fused set
5. `recallByQuery` runs the reranker over the (bounded) fused candidate set when `reranker.enabled`
6. `recallByQuery` walks the 2000-token budget using `estTokens` (BPE) and returns top-N

### nexus_search (unchanged surface, shared fusion)
1. Caller invokes `hybridSearchMemories(query, opts)`
2. It builds FTS5-ranked and vector-ranked id lists
3. It calls `rrfFuse([ftsIds, vecIds])` (same helper as recall)
4. It hydrates rows in fused order and returns

### Export MEMORY.md
1. `exportAll` gathers approved memories per project bucket
2. Sorts by decay rank desc, keeps top `capture.memory_md_max_items`
3. Writes title + first-line hooks up to the cap
4. If truncated, appends one pointer line referencing `nexus_search`

---

## Storage

### `extraction_models.yaml` — `capture` section (config only, no DB schema)
```
capture:
  memory_md_max_items: 200   # NEW. per-bucket cap on MEMORY.md index entries.
                             # absent -> DEFAULTS 200 in config.ts

reranker:
  enabled: true              # DEFAULT flipped in config.ts; yaml may still override
```

### `MEMORY.md` per-bucket index (file format, capped)
```
# <one line per retained memory, ordered by decay rank>
- <title> — <first-line hook>
...
> … {remaining} more memories — use nexus_search to retrieve them.   # only if truncated
```

### New dependency
```
gpt-tokenizer   # pure-JS BPE (cl100k_base). No native build, no WASM. dependencies-light.
```

---

## Decisions

### Q1 — Tokenizer choice: `gpt-tokenizer` (cl100k_base BPE)
**Decision:** Replace the 4-chars/token heuristic with `gpt-tokenizer`'s `encode()` on the
`cl100k_base` encoding, memoized per walk, with the old heuristic as a try/catch fallback.
**Alternatives:** (a) keep an improved heuristic (word-count + code-block detection); (b)
`tiktoken` WASM binding; (c) `@anthropic-ai/tokenizer` (deprecated for Claude 3+, no stable
public Claude tokenizer exists).
**Rationale:** Success criteria require a *meaningfully tighter* error margin vs real
tokenizer counts — a heuristic cannot guarantee that on code/ADR snippets, which is exactly
where the flat estimate fails. No exact public Claude tokenizer exists, so any choice is an
approximation; a real BPE tokenizer (GPT family) tracks true subword counts far closer than
chars/4, especially for code and non-English. `gpt-tokenizer` is pure JS with no native/WASM
build step, keeping the flat-codebase constraint. cl100k_base over o200k_base for smaller
load footprint and proven stability; the absolute encoding family matters less than moving
off chars/4. Signature stays `estTokens(s): number` so no caller changes and `recall.test.ts`
extends rather than rewrites.

### Q2 — RRF extraction shape: generic pure helper, atoms untouched
**Decision:** Extract `rrfFuse(rankedLists, k)` operating on generic ranked id-lists into
`src/core/rrf.ts`. Refactor `hybridSearchMemories` and add `recallByQuery` to both call it.
Leave the atoms-side `hybridSearch()` as-is.
**Alternatives:** a memories-specific extraction that carries row shape; or refactoring atoms
`hybridSearch()` to share too.
**Rationale:** The RRF math is `sum(1/(k+rank))` over positions — a generic id-list helper is
*smaller* than a memories-typed one and carries no DB/embedding coupling, best fitting
"minimal abstraction." Touching atoms `hybridSearch()` is out of scope and adds regression
surface for no design item; atoms reuse is not trivial enough to justify. Keeping the helper
storage-agnostic still leaves each caller owning its own hydration.

### Q3 — recallByQuery pool sizing and reranker scope
**Decision:** Keep vector pool at `limit*6`; add an FTS5 pool of `limit*3` (its existing
fallback-path size). Fuse both via `rrfFuse`, then apply `excludeIds` and the `minSimilarity`
floor. Run the reranker over the fused candidate set (bounded to a small cap, e.g. the fused
top ~`limit*3`), not the vector subset only.
**Alternatives:** matching FTS5 pool to `limit*6`; reranking only the vector subset as today.
**Rationale:** `limit*3` reuses a size already validated in the current FTS5 fallback, so no
new tuning risk. Reranking must see FTS5-only hits or the whole point of fusion (surfacing a
keyword-exact match a strong cosine hit suppressed) is undone before the reranker runs.
Bounding the reranker input keeps per-prompt latency in the validated 50–100ms envelope.

### Q4 — Consolidation rewrite step: NO-GO (both rewrite and pre-LLM scoring declined)
**Decision:** Do not add an LLM rewrite/body-compaction step to `consolidateMemories()`, and
do not add pre-LLM per-candidate signal scoring in the capture path. Record both decisions as
code comments; make no behavioral change.
**Alternatives:** add a Haiku rewrite pass over surviving memories; add a per-candidate
scoring rubric before the extraction call.
**Rationale:** At current per-bucket memory volume the embed+prune+merge-supersede subset
already handles dedup. A rewrite pass adds Haiku latency/cost on the consolidation path,
injects LLM nondeterminism into stored bodies, risks lossy compaction, and has no schema to
record provenance (schema changes forbidden). The real downstream pain — an unbounded
auto-loaded index — is addressed directly and deterministically by the MEMORY.md cap (Q5),
which is cheaper and safer than rewriting bodies. Pre-LLM scoring duplicates the existing
observer gate plus `refineCandidates`'s post-hoc narration filter for negligible gain.

### Q5 — MEMORY.md cap unit and threshold: item count, default 200
**Decision:** Cap by number of index entries (lines), default `capture.memory_md_max_items:
200`, retained by decay-rank. Overflow appends a single pointer line to `nexus_search`.
**Alternatives:** byte cap; combined line+byte cap; capping shown titles like recall's
`max_title_items`.
**Rationale:** Lines map most directly to the token cost of an auto-loaded index and mirror
recall's existing title-elision pattern, so the behavior is already familiar and testable. A
byte cap is fuzzier, harder to assert in `export.test.ts`, and redundant once entry count is
bounded. Sorting by decay rank ensures truncation keeps the highest-value memories; the
pointer line preserves discoverability of the elided tail.

### Q6 — MCP audit deliverable: `add-note`
**Decision:** Produce the audit as `_documents/notes/note-NNN-mcp-tool-surface-audit.md` via
the `add-note` skill (which rebuilds `_documents/notes.md`).
**Alternatives:** `add-reference` (`ref-NNN-*.md`).
**Rationale:** References point at external sources; this is an internal, project-specific
finding that will be revisited and edited as the tool surface evolves — and notes are mutable
per the project doc protocol. `add-note` is the correct skill.

### Branch ordering (from design, confirmed)
**Decision:** One sequential branch, ordered: (1) tokenizer, (2) MCP audit note, (3)
capture/consolidation (rewrite no-go + MEMORY.md cap), (4) RRF reuse, (5) reranker default.
**Alternatives:** five branches/PRs.
**Rationale:** All five are small, well-isolated, with nearby test coverage; sequential
ordering lands the highest-touch ranking changes (RRF, reranker default) last so regressions
are easy to isolate, at lower cost than five-branch coordination overhead.

---

## Open Questions
<!-- These must be resolved before /plan runs. Planner will fail if ambiguous. -->
- Latency spot-check (design step 5): the 50–100ms reranker figure must be re-confirmed
  empirically at *per-prompt* frequency over the fused (not vector-only) candidate set before
  the `DEFAULTS.reranker.enabled = true` flip is committed. If the fused-set rerank exceeds
  that envelope, the reranker input cap (Q3) is the tuning knob — resolve during item 4/5
  implementation, not a blocker on architecture.
