# Implementation Spec — Capture/Recall Hardening

## Approach

Test-driven, one feature branch (`feature/capture-recall-hardening`), five items landed
safest-first so each is verifiable before the next stacks on it. Every code item extends the
existing colocated `*.test.ts` rather than rewriting it. Two of the "capture/consolidation"
sub-items (rewrite step, pre-LLM scoring) resolve to **decision comments only** (Q4 NO-GO), not
code. The ranking work is DRY'd behind one pure helper (`src/core/rrf.ts`) consumed by both the
`nexus_search` path and the per-prompt recall path. The MEMORY.md cap and the reranker flip are
driven from `config.ts` DEFAULTS so no schema/migration is touched.

## Build Order & Dependencies

Phases run in the design's stated sequence; `depends_on` encodes it. The MCP audit note (task-003)
is the one deliverable with zero file overlap and is intentionally left parallel to the whole
chain (design: "No dependency on the other items").

- Phase 1 — Tokenizer: task-001 (dep add) → task-002 (estTokens swap)
- Phase 2 — MCP audit: task-003 (parallel, doc-only)
- Phase 3 — Capture/consolidation: task-004, task-005 (decision comments, parallel) and
  task-006 (config default) → task-007 (export cap)
- Phase 4 — RRF: task-008 (pure helper) → { task-009 (search refactor), task-010 (recall fusion) }
- Phase 5 — Reranker: task-011 (latency spot-check) → task-012 (default flip)
- Gate: task-013 (full-suite green)

Critical path: task-001 → 002 → 006 → 007 → 008 → 010 → 011 → 012 → 013. Phase 3/4/5 chain onto
Phase 1 transitively so `recall.ts` (task-002, 010, 011) and `config.ts` (task-006, 012) are never
edited concurrently.

## Per-Component Implementation

### TokenEstimator — task-001, task-002 (`package.json`, `src/core/recall.ts`, `src/core/recall.test.ts`)
- Build: add `gpt-tokenizer` as a normal dependency, pinned. Reimplement `estTokens` to call
  `encode()` and return `.length`, wrapped in `try/catch` that returns `Math.ceil(s.length / 4)`
  on any throw. Memoize with a module-level `Map<string, number>` keyed by the raw string;
  process-lifetime caching is acceptable (bodies/titles recur across walks) — bound it or accept
  it, correctness rests on the fallback, not the cache. Signature stays `estTokens(s): number`;
  the single change covers both the full-body budget walk and the title-only elision walk since
  both already call it.
- Tests: **unit**. Assemble a fixture of code-snippet and prose bodies with their real
  `cl100k_base` counts; assert `|estTokens - actual|` is meaningfully tighter than
  `|ceil(len/4) - actual|`. Add a fallback test stubbing `encode` to throw and asserting the
  chars/4 result. Rationale: pure deterministic function; unit fully covers it.
- Edge cases: empty string → 0; `encode` throw → chars/4 fallback (never propagate); unbounded
  cache growth under adversarial input (bound if it matters); the estimate feeding budget elision
  must stay monotonic-ish so a larger body never estimates smaller than a strict substring.

### MCP Audit Note — task-003 (`src/mcp/server.ts`, `_documents/notes/note-NNN-mcp-tool-surface-audit.md`, `_documents/notes.md`)
- Build: read `server.ts`, enumerate every registered tool, then invoke the `add-note` skill (it
  assigns NNN and rebuilds `notes.md` via `scripts/rebuild_index.py` — do not hand-edit the index).
  Body: current count vs the ADR-011 baseline, one line per tool, grouping/consolidation candidates
  if any, and exactly one recommendation ∈ {consolidate now | revisit later | no action}.
  Audit only — no change to `server.ts`.
- Tests: **none**. No production code; reviewed by a human. Automated assertions add no value.
- Edge cases: keep the recommendation explicit even if it is "no action"; ambiguity fails SC-2.

### Consolidate Decision Comment — task-004 (`src/capture/consolidate.ts`)
- Build: header comment on `consolidateMemories()` recording the Q4 rewrite NO-GO — embed +
  prune-rejected + merge-by-supersede is sufficient at current per-bucket volume; downstream index
  bloat is handled by the MEMORY.md cap, not by rewriting bodies; no schema exists to record
  rewrite provenance. No behavioral change, signature unchanged.
- Tests: **none** (comment-only). Existing consolidate tests stay green as the regression guard.
- Edge cases: comment must state the go/no-go unambiguously (SC-3) — "rewrite not warranted,
  because Y", not a hedge.

### Pre-LLM Scoring Decline Comment — task-005 (`src/capture/extract.ts`)
- Build: comment near `refineCandidates()` recording the Q4 pre-LLM-scoring NO-GO — the reflector
  observer gate plus `refineCandidates`' post-hoc `COMPLETION_RE` narration filter already cover the
  practical case. No behavioral change.
- Tests: **none** (comment-only). Existing extract tests stay green.
- Edge cases: none; keep it a comment, resist adding scoring code.

### Export MEMORY.md Cap — task-006, task-007 (`src/core/config.ts`, `src/capture/export.ts`, `src/capture/export.test.ts`)
- Build: task-006 adds `capture.memory_md_max_items = 200` to DEFAULTS (merge logic untouched;
  yaml overrides). task-007 changes `exportAll()` to, per bucket, sort approved memories by decay
  rank desc, keep the top N, and append one pointer line only on overflow:
  `> … {remaining} more memories — use nexus_search to retrieve them.` where
  `remaining = total - N`.
- Tests: **unit** on the writer (`export.test.ts`). Large synthetic bucket > cap: assert entry
  count == N, retained set == top-N by decay rank, exactly one pointer line with correct
  `{remaining}`. Under-cap case: no pointer line, no truncation. Exactly-at-cap: no pointer line.
  The 200 default is exercised transitively here (config → export). Rationale: deterministic file
  output; asserting entry count is precise where a byte cap would be fuzzy.
- Edge cases: zero memories → empty index, no pointer; exactly N → no pointer (strict `>`);
  decay-rank ties → stable order so truncation is deterministic; each bucket capped independently;
  invalid/absent config value → fall back to 200.

### RRF Fusion — task-008 (`src/core/rrf.ts`, `src/core/rrf.test.ts`), task-009 (`src/core/search.ts`, `src/core/search.test.ts`), task-010 (`src/core/recall.ts`, `src/core/recall.test.ts`)
- Build (task-008): `rrf.ts` exports `RRF_K = 60` and `rrfFuse(rankedLists, k)` summing
  `1/(k + rank)` per list position, returning `{id, score}[]` sorted desc. Pure, no DB/embedding
  imports.
- Build (task-009): refactor `hybridSearchMemories()` to build its FTS5 and vector id lists, call
  `rrfFuse([ftsIds, vecIds])`, then hydrate in fused order. Signature and external behavior
  unchanged; atoms-side `hybridSearch()` deliberately untouched.
- Build (task-010): rework `recallByQuery()` — vector pool `limit*6`, FTS5 pool `limit*3`, fuse via
  `rrfFuse`, drop `excludeIds`, apply the `minSimilarity` floor, then rerank the bounded fused set
  (~top `limit*3`) when enabled. Keep the `estTokens` budget walk at the end.
- Tests: task-008 **unit** (fusion math is high-value and pure). task-009 **integration/
  characterization** — existing search tests must stay green proving the refactor is
  behavior-preserving; add a fixture asserting fused order is unchanged from the inlined loop.
  task-010 **integration** (`recall.test.ts`) — SC-5: a keyword-exact FTS5 hit that a stronger
  cosine match currently suppresses must appear in the fused top-N after the change; plus
  `excludeIds` dropped, floor applied, reranker sees FTS5-only hits. Use an in-memory SQLite
  fixture with stubbed embeddings/reranker for determinism.
- Edge cases:
  - **Floor vs FTS5 (decision required in task-010):** the `minSimilarity` floor must not
    re-suppress the FTS5-exact hits fusion just surfaced. Apply the floor to vector-originated
    candidates only; FTS5-matched ids bypass the floor (they earned inclusion by keyword match),
    otherwise SC-5's whole point is undone before the reranker runs.
  - `rrfFuse`: empty input → `[]`; an id absent from a list contributes 0; duplicate id within one
    list → first position wins; guard `k <= 0`.
  - `recallByQuery`: FTS5 empty → vector-only still works; vector empty → FTS5-only now works
    (strict improvement over the old fallback); everything excluded/floored → return empty
    gracefully; reranker disabled or throwing → fall back to fused order; bound reranker input to
    keep latency in envelope.

### Reranker Default — task-011 (`src/core/recall.ts`), task-012 (`src/core/config.ts`, `src/core/config.test.ts`)
- Build (task-011): measure `recallByQuery`'s reranker pass over the fused set at per-prompt
  frequency; confirm 50–100ms envelope; record the observed figure as a comment at the rerank call
  site. If it overruns, tighten the bounded fused-set rerank cap (Q3) in `recall.ts` until it fits
  and note the final cap. Not a benchmark harness.
- Build (task-012): flip `DEFAULTS.reranker.enabled` false → true; merge logic unchanged.
- Tests: task-011 **none** (measurement/spot-check, per design). task-012 **unit** — assert
  `getNexusConfig().reranker.enabled === true` when yaml omits the key, and that explicit yaml
  `reranker.enabled: false` still wins. Rationale: default-merge behavior, cheap to pin.
- Edge cases: yaml present but `reranker` block absent vs present-with-`enabled`-absent — default
  applies only on absence, never overriding an explicit `false`; the flip must land only after
  task-011's latency confirmation (it gates task-012).

### Integration Gate — task-013 (test suites)
- Build: run the full Vitest suite on the branch (recall, search, export, extract, rrf, config);
  fix any cross-item regression, especially the RRF-fusion × reranker-default interaction.
- Tests: **integration** — the suite itself is the assertion. Rationale: catches cross-item
  regressions the per-item tests can't see in isolation; confirms no assertion was weakened (SC-7).

## Test Strategy Summary

| Component | Level | Rationale |
|---|---|---|
| TokenEstimator | unit | pure deterministic function + fallback path |
| MCP audit note | none | doc deliverable, human-reviewed |
| Consolidate comment | none | comment-only, existing tests guard |
| Pre-LLM scoring comment | none | comment-only, existing tests guard |
| Export cap + config default | unit | deterministic file output; entry-count assertion precise |
| rrfFuse | unit | pure fusion math, high value |
| hybridSearchMemories refactor | integration/characterization | behavior-preserving; existing tests as guard |
| recallByQuery fusion | integration | needs FTS5 + vector interplay; SC-5 requires it |
| reranker latency | none | spot-check, not a benchmark harness (design) |
| reranker default flip | unit | config merge/default behavior |
| final gate | integration | cross-item regression catch |
