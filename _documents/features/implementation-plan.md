# Feature Implementation Plan

> Generated from 26 planned features in `_documents/features/`. All verdicts and sequencing steps are grounded in feature source files and user-supplied answers; no content is inferred.

---

## Overview

This plan groups all 26 `planned` features into area buckets so related changes can be designed and implemented together. Any feature that no longer fits the tool's stated intent is flagged for dropping in the Fit Check section.

**Priority driver: value to active workflows.** Features that most improve day-to-day capture/recall quality now are prioritized over pure risk-reduction or effort-to-value ranking. [answers.json q-001]

**Research/spike handling:** Features tagged `needs-research` receive a scoped research/spike step as the first step in their bucket's sequencing, inline — not pulled into a separate section. [answers.json q-008]

**Bucket summary:**

| Bucket | Features |
|--------|----------|
| Capture/Extraction Tuning (vcc_compact) | 5 |
| Retrieval & Recall | 10 |
| Memory Lifecycle & Governance | 3 |
| Capture Identity & Guardrails | 2 |
| Scope & Filtering | 2 |
| Local Inference Infra | 3 |
| Long-term / Exploratory | 1 |

Fit check verdict (all 26): **24 KEEP, 2 DEFER, 0 DROP.**

---

## Capture/Extraction Tuning (vcc_compact)

Features affecting extraction quality, prompt tuning, the vcc_compact source path, and validation coverage.

### FEAT-20260802190757-2d — Fix vcc_compact rendering quality and re-enable post-extraction shrink

`needs-research` | `data-safety`

`_documents/decisions/adr-015-disable-vcc-post-extraction-shrink-in-reflectorts.md` disabled reflector.ts's call to `vcc.compactFileInPlace()` because a review found real information loss in vcc_compact's rendering — opaque Bash/PowerShell tool-result citations and small-but-critical tool results get dropped when not restated in prose. `compactFileInPlace()` overwrites the only copy of the raw transcript JSONL in place, making a known-lossy renderer unacceptable to run against it. That decision document names fixing the rendering quality first, then re-enabling, as the deferred precondition, but does not specify how the renderer should be fixed. [feature-20260802190757-2d]

> Note: The authoritative disable-shrink decision is `_documents/decisions/adr-015-disable-vcc-post-extraction-shrink-in-reflectorts.md`. The architecture.md index currently mislabels a different ADR as "ADR-015" — that is a separate doc-hygiene issue tracked in Pending / Follow-up.

**Steps:**
1. Research spike: define what "rendering quality fixed" means — specify which loss classes (opaque tool-result citations, small critical results) must be eliminated before re-enabling.
2. Fix vcc_compact renderer to preserve tool-result citations.
3. Re-verify rendering quality on a representative sample of real transcripts.
4. Re-enable `vcc.compactFileInPlace()` in reflector.ts.

---

### FEAT-20260730150709-cf — Reconstruct permanent incremental-window extraction validation harness

`needs-research`

The one-off scratch harness used to validate both the whole-session-vs-incremental-window completeness gap and the preference-crowding fix (NOTE-20260730134513-3b) was cleaned up after use per project convention. There is currently no repeatable way to re-verify that future SYSTEM_PROMPT changes do not regress incremental-window extraction quality. [feature-20260730150709-cf]

**Steps:**
1. Research spike: decide what a maintainable (non-scratch, committed) validation harness looks like — fixture format, runner, assertion strategy.
2. Implement and commit the harness.
3. Baseline current SYSTEM_PROMPT before FEAT-20260730150641-ad changes land.

---

### FEAT-20260730150641-ad — Adopt phase-section-cue prompt tuning for vcc_compact extraction

Validated via experiment on real Flow-structured sessions: significantly improved extraction completeness, recovering ADR/DDR pointers, concurrency bugs, and tool quirks the untuned prompt missed. Only the smaller preference-crowding addendum (NOTE-20260730134513-3b) shipped so far; the broader phase-cue tuning is still pending. [feature-20260730150641-ad]

**Steps:**
1. Add the validated phase-section-cue instruction ("treat each `### Phase: <name>` section as an independent unit worth scanning for at least one durable fact") to `extract.ts`'s `SYSTEM_PROMPT` for the vcc_compact-sourced path.
2. Run against real vcc_compact sessions using the FEAT-cf harness; verify no whole-session/backfill regression.

---

### FEAT-20260730150650-7f — Raise MAX_CANDIDATES for vcc-sourced extraction path

Depends on FEAT-20260730150641-ad. MAX_CANDIDATES (currently 20, in extract.ts) is not yet a binding constraint on incremental windows (max observed 9–11/window) or most whole-session runs, but will become one once phase-section-cue tuning is adopted, since that cue can push whole-session or long-window extraction close to or past the current cap. [feature-20260730150650-7f]

**Steps:**
1. Adopt FEAT-20260730150641-ad first.
2. Profile candidate counts on representative vcc_compact sessions post-tuning.
3. Raise MAX_CANDIDATES to a value that avoids truncation.

---

### FEAT-20260730150718-3e — Window-only extraction prompt variant (contingent)

**DEFER.** Explicitly deferred in source: "Revisit only if the shared-addendum approach (NOTE-20260730134513-3b) is later found to regress whole-session or backfill extraction quality; not needed otherwise." Touching the exported `Extractor` type and every conforming caller (reflector.ts, backfill.ts, prompt-runner.ts, plus test fakes) was out of scope for the two-file constraint at the time. [feature-20260730150718-3e]

No sequencing slot. Trigger: confirmed regression in whole-session or backfill extraction from the shared addendum.

---

## Retrieval & Recall

Features affecting recall quality, search fusion, result ranking, and embedding pipeline efficiency. Includes the two embedding-performance features assigned here by user direction. [answers.json q-006]

### FEAT-20260805151847-3d — Hash-based skip of unchanged memories on re-embedding/reindex passes

`performance`

Cache embeddings by a content hash (SHA-256) of the memory body so `nexus_reindex` and similar bulk passes only re-embed memories whose content actually changed, instead of re-embedding the full corpus every time. [feature-20260805151847-3d]

**Must ship before or alongside FEAT-ae's corpus reindex step** — without this gate in place, the FEAT-ae reindex re-embeds every unchanged memory at full cost with no benefit.

**Steps:**
1. Add a `content_hash` column to the memories table (migration).
2. Compute SHA-256 on write; skip re-embedding if hash unchanged on reindex.

---

### FEAT-20260805151847-ae — Contextual retrieval indexing: prepend context header before embedding

Prepend a short context header (project, memory_type, decay_class, related topic) to each memory body before embedding — mirroring Anthropic's contextual retrieval technique. Nexus already has BM25+RRF (ADR-003) and reranking (ADR-012); only the context-prepend step is missing. [feature-20260805151847-ae]

> **Benchmark caveat:** The often-cited figures for this technique (35% fewer retrieval failures alone, 49% combined with BM25, 67% combined with reranking) come from Anthropic's contextual retrieval blog post on generic RAG benchmarks, not from Nexus's specific stack (mxbai-embed-large + FTS5 + sqlite-vec on short typed memories). They are directional evidence only. Nexus-specific validation is required in step 3 before treating those magnitudes as projections.

**Prerequisite:** FEAT-3d (hash-based skip) must be in place before step 2, so the corpus reindex only re-embeds memories whose content changes (all bodies gain a new header prefix and must be re-embedded; FEAT-3d prevents re-embedding the same body twice if this reindex is re-run).

**Steps:**
1. Modify embedding path in embeddings.ts to prepend the context header before encoding.
2. Reindex corpus (FEAT-3d must be in place; see prerequisite note above).
3. Evaluate recall quality on a representative query set against the pre-prepend baseline; do not treat external benchmark figures as Nexus-validated projections until this step completes.

---

### FEAT-20260805151847-8e — Query rewriting before recallByQuery embedding

Auto-rewrite the user's prompt into a more retrieval-friendly query before it is embedded for recallByQuery (ADR-009), the way OpenAI's retrieval API's `rewrite_query` option does. [feature-20260805151847-8e]

**Steps:**
1. Add a query-rewrite step in prompt-runner.ts before the embedding call.
2. Evaluate retrieval quality improvement on representative prompts.

---

### FEAT-20260805151847-4c — Reorder-then-compress: highest-relevance memories at context boundaries

When assembling injected recall context, place highest-relevance memories at first/last positions (not buried in the middle) before applying the existing full-body-to-titles-only degradation (FEAT-008), to mitigate "lost in the middle" attention degradation on longer injected context. [feature-20260805151847-4c]

**Steps:**
1. Modify recall assembly in prompt-runner.ts to sort by relevance and position highest-scored memories at first/last before injection.

---

### FEAT-002 — Evaluate jina-reranker-v3 over v2 for prompt-driven recall

`src/core/reranker.ts` is pinned to `jina-reranker-v2-base-multilingual`. jina-reranker-v3 is described as a newer, smaller, stronger listwise model (BEIR 61.94 at 0.6B params). Reranker is already enabled by default (ADR-012); this is an evaluation-only step. [feature-002]

**Steps:**
1. Swap the model pin in reranker.ts to jina-reranker-v3.
2. Evaluate recall quality on a representative sample; compare to v2 baseline.
3. Accept or revert.

---

### FEAT-20260805151847-81 — Compound attribute filters for nexus_search (eq/in/and/or)

Extend `nexus_search` filtering beyond the current scope enum to a structured compound filter schema (eq/in/and/or) over typed memory fields, matching the shape used by OpenAI's file_search attribute filters. [feature-20260805151847-81]

**Steps:**
1. Design compound filter schema (eq/in/and/or).
2. Add filter parsing and SQL generation to nexus_search in mcp/server.ts.
3. Update MCP tool schema and tests.

---

### FEAT-20260805151847-68 — Tunable embedding/text weight for hybrid search fusion

`needs-research`

Nexus uses a fixed RRF_K=60 fusion (ADR-003). Requires evaluating whether a tunable `embedding_weight`/`text_weight` ratio improves recall quality enough to justify the added config surface. [feature-20260805151847-68]

**Steps:**
1. Research spike: evaluate whether weight tuning improves recall quality on representative queries vs. current fixed RRF.
2. If positive: implement tunable weights in hybrid search; expose via extraction_models.yaml.
3. If not positive: document the RRF_K=60 as a validated fixed point.

---

### FEAT-20260805151847-77 — Reduced-dimension embeddings for storage/speed

`needs-research` | `performance`

Requires checking whether mxbai-embed-large supports reduced output dimension (Matryoshka-style truncation) without meaningful recall-quality loss, to cut vector storage size and search latency. [feature-20260805151847-77]

**Steps:**
1. Research spike: verify mxbai-embed-large Matryoshka support; benchmark recall quality at reduced dimension vs. full dimension.
2. If positive: update embeddings.ts and vector column dimensions; reindex.

---

### FEAT-20260805151847-d1 — Typed metadata retrieval filters (string/number/time)

`needs-research`

Requires investigating whether adding typed metadata fields (beyond the current scope/decay_class enums) with numeric/time range filtering on nexus_search would meaningfully improve targeted recall. [feature-20260805151847-d1]

**Steps:**
1. Research spike: identify which metadata fields would provide meaningful range filtering; assess schema additions required.
2. If positive: design schema additions and extend nexus_search filtering. Coordinate with FEAT-81 (compound attribute filters) to avoid duplicate work.

---

### FEAT-20260805151847-bd — Averaged session/project embeddings for topic-drift detection

`needs-research`

Requires investigating whether aggregating (averaging) per-turn embeddings into a rolling session or project vector could detect topic drift and improve recall personalization or governance signals. [feature-20260805151847-bd]

**Steps:**
1. Research spike: prototype averaged embeddings per session; measure correlation with observable topic-drift signals.
2. If positive: define storage and update cadence; integrate into recall or governance path.

---

## Memory Lifecycle & Governance

Features affecting promotion gating, reference-upgrade integrity, and memory quality assessment.

### FEAT-20260730150659-74 — Validate cited ADR/DDR id before Fix-1 reference-upgrade supersede

Before performing the supersede-insert upgrade in reflector.ts's `isReferenceUpgrade` path (ADR-20260730134500-2c), validate the cited ADR/DDR id against `readDecisionIndex(opts.cwd)` — already in scope at the reflect() call site — to guard against a hallucinated id (e.g. "ADR-999") triggering an unwarranted supersede of a real decision memory. Explicitly flagged as an open TODO in the design doc for ADR-20260730134500-2c and deliberately left out of the shipped scope to keep that change to two files. Low effort. [feature-20260730150659-74]

**Steps:**
1. In reflector.ts's isReferenceUpgrade path, call `readDecisionIndex(opts.cwd)` and verify the cited id exists before proceeding with the supersede-insert.
2. Add a test case: hallucinated ADR id must not trigger a supersede.

---

### FEAT-005 — Gate nexus_promotions candidates by accumulated hit_count/reconfirmation

`promotion_target` is currently set once by Haiku at write time and never revisited (confirmed by direct grep: governance.ts never touches promotion_target). This risks surfacing premature promotion candidates that later prove rarely used or unreliable. Recommended: add a threshold gate (e.g. `use_count >= 3` and/or a `help_rate` floor) before a flagged memory surfaces in nexus_promotions. Low-medium effort — additional WHERE-clause filter in nexus_promotions SQL; use_count/help_count already exist on the memories table, no schema change needed. [feature-005]

**Steps:**
1. Add threshold filter (use_count, help_rate) to the nexus_promotions SQL query in mcp/server.ts.
2. Expose thresholds as configurable values (extraction_models.yaml or MCP tool parameters).

---

### FEAT-20260805151847-ce — Formal 3-axis memory quality eval rubric (recall/preference/staleness)

`needs-research`

Requires investigating how to score memories along three separate quality axes (retrieval usefulness, user preference alignment, staleness) rather than the current single `effectiveConfidence`/help-rate signal. [feature-20260805151847-ce]

**Steps:**
1. Research spike: define the three axes operationally; identify existing captured signals that map to each.
2. If viable: design scoring schema additions; define how governance (governByHelpRate) uses or extends the rubric.

---

## Capture Identity & Guardrails

Features affecting capture safety, data hygiene, and project identity.

### FEAT-001 — Secret-redaction guard on the capture path

Add a regex/entropy-based secret, credential, and token screen to the memory-capture path (extract.ts post-processing or a gate in reflector.ts before write) so pasted secrets in transcripts are never permanently persisted into the memories table or its markdown export. Confirmed gap by direct grep of extract.ts/transcript.ts: no content-safety filter exists today, only the durable-knowledge-only style/tone system prompt. [feature-001]

**Recommendation — build in-house first.** A regex + entropy scorer in extract.ts or reflector.ts introduces no new external dependency and keeps the trust surface entirely within this codebase. Adding a third-party library (e.g. GuardrailEngine, Pi.dev) directly on the capture path is a supply-chain and data-handling trust decision that should not default to an external dependency without evaluating what data the library touches and under what terms. GuardrailEngine is a viable future swap-in if the in-house gate proves insufficient, but it should not be the starting point. [answers.json q-009]

**Steps:**
1. Implement an in-house regex/entropy gate (API keys, bearer tokens, connection strings, private keys) in extract.ts post-processing or as a pre-write filter in reflector.ts. GuardrailEngine is noted as a future swap-in candidate if this proves insufficient.
2. Add tests covering secret-shaped strings (API keys, bearer tokens, connection strings, private keys).

---

### FEAT-003 — Non-git-repo fallback for project-slug resolution

`resolveGitProjectRoot()` in project-root.ts falls back to the raw, unmodified cwd when git is unavailable, times out, or cwd is not inside a git repository (confirmed by direct code read: the catch block returns cwd unchanged). This reintroduces exactly the subdirectory-fragmentation problem ADR-013 fixed for the git case — two subdirectories of the same non-git project resolve to two different slugs. Needs a decision on whether to build a non-git resolution heuristic (e.g. nearest package.json/.git-sibling) or explicitly document the fallback as an accepted limitation. [feature-003]

**Steps:**
1. Decide: implement non-git heuristic or accept and document the limitation.
2. If implementing: add heuristic to project-root.ts; cover with tests matching the git-case test patterns.
3. If accepting as limitation: update CLAUDE.md and file-map.md to note the explicit constraint.

---

## Scope & Filtering

Features affecting memory scope partitioning and capture noise reduction.

### FEAT-20260805151847-56 — Per-skill memory scope (beyond project/shared/global)

`needs-research`

Investigates whether a fourth scope partition keyed to the invoking skill/agent would reduce cross-skill memory noise, and how it would interact with existing scope isolation. FEAT-006 (scope enum: global/shared/project, settable as a caller parameter on nexus_remember, nexus_remember_batch, and as a filter on nexus_search) is already implemented — FEAT-56 is additive work layered on top of the shipped scope system, not blocked on it. [feature-20260805151847-56, answers.json q-005]

**Steps:**
1. Research spike: prototype a per-skill scope key on a real multi-skill session; assess whether it reduces noise without fragmenting recall unacceptably.
2. If positive: extend scope enum or add a `skill_scope` field; update MCP tool schemas and mcp/server.ts.

---

### FEAT-20260805151847-5a — Loop-prevention memory: track already-attempted fixes

`needs-research`

Requires investigating a write convention (new memory_type or tag) that records a fix/approach already tried and failed, so recall can suppress re-suggesting it in the same debugging session. [feature-20260805151847-5a]

**Steps:**
1. Research spike: define the write convention (dedicated memory_type value, tag, or field); decide how recall filters it by session scope without bleeding into future sessions.
2. If viable: implement the write convention in extract.ts/reflector.ts and the recall suppression in prompt-runner.ts.

---

## Local Inference Infra

Features affecting the local model serving stack (reranker, embedder, extraction model). FEAT-eb is explicitly gated on FEAT-2a. [answers.json q-004]

### FEAT-20260805151848-2a — Local model co-residency/routing plan for reranker + embedder

`needs-research`

Requires investigating a co-resident or swap-routed local model layout (e.g. via llama-swap) so nexus's local reranker (ADR-012) and mxbai-embed-large embedder run alongside other locally-served models without VRAM contention, rather than being planned in isolation. [feature-20260805151848-2a]

**Steps:**
1. Research spike: evaluate llama-swap or equivalent co-residency configuration for reranker + embedder.
2. Define target config; document VRAM budget allocation.
3. Implement and verify no regression on nexus_recall latency under co-resident load.

---

### FEAT-20260805151847-7e — Cosine-similarity zero-shot classification as a cheaper alternative to Haiku calls

`needs-research`

Requires evaluating whether cosine similarity against a small set of labeled anchor embeddings can replace Haiku-based classification calls (e.g. origin classification, governance checks) for cost/latency wins where full LLM judgment is not needed. Grouped under Local Inference Infra by mechanism: embedding-based inference cheaper than LLM. [feature-20260805151847-7e, answers.json q-007]

**Steps:**
1. Research spike: enumerate Haiku classification call sites in origin.ts and governance.ts; prototype anchor-embedding classifiers; compare accuracy vs. Haiku baseline.
2. If positive: replace specific call sites with cosine classifier; keep Haiku for high-stakes judgments.

---

### FEAT-20260805151847-eb — Constrained decoding for JSON-schema-valid Haiku extraction output

`needs-research` | gated on FEAT-2a (local model serving)

Only applicable if/when nexus's extraction model is served locally rather than via the Anthropic API. Requires investigating whether a constrained-decoding layer (XGrammar/llguidance/GBNF-style JSON schema enforcement) is available for the extract.ts call path to guarantee schema-valid memory JSON output and eliminate parse-failure retries. [feature-20260805151847-eb]

**Steps:** (only after FEAT-2a unblocks local extraction serving)
1. Research spike: evaluate constrained-decoding library options (XGrammar, llguidance, GBNF); check integration surface with the local serving stack.
2. If viable: integrate into the local extraction call path in extract.ts.

---

## Long-term / Exploratory

### FEAT-004 — Structural/graph memory

**DEFER.** Source explicitly: "not an active work item." The improvements synthesis does NOT recommend this as a near-term change: nexus's flat SQLite design (WAL + FTS5 + sqlite-vec, typed memory_type/decay_class/scope/promotion_target fields) matches the project's flat-codebase/minimal-abstraction philosophy and already supports typed relationships without a graph engine. Recorded as a deferred, low-priority option to revisit only if a concrete retrieval-quality problem emerges that the current schema cannot address. [feature-004]

No implementation steps. Trigger: a concrete, reproducible retrieval-quality failure that the flat schema demonstrably cannot address.

---

## Fit Check: Candidates to Drop

Per-feature verdict for all 26 planned features. Verdicts: **KEEP** (active planned work), **DEFER** (contingent or explicitly non-near-term), **DROP** (no longer fits intent).

| Feature | Short title | Verdict | Basis |
|---------|-------------|---------|-------|
| FEAT-001 | Secret-redaction guard | KEEP | Confirmed safety gap; no content-safety filter exists today [feature-001] |
| FEAT-002 | Evaluate jina-reranker-v3 | KEEP | Reranker already live; v3 evaluation is a bounded, low-risk step [feature-002] |
| FEAT-003 | Non-git slug fallback | KEEP | Confirmed code gap (catch block returns raw cwd); needs a decision [feature-003] |
| FEAT-004 | Structural/graph memory | DEFER | Source explicitly marks "not an active work item" and "not recommended near-term"; revisit only on concrete schema failure [feature-004] |
| FEAT-005 | Gate promotions by hit_count | KEEP | Confirmed gap via grep; low-effort WHERE-clause fix [feature-005] |
| FEAT-20260730150641-ad | Phase-section-cue prompt tuning | KEEP | Validated via experiment; recovering real missed facts [feature-20260730150641-ad] |
| FEAT-20260730150650-7f | Raise MAX_CANDIDATES | KEEP | Will be needed once FEAT-ad ships; bounded follow-on change [feature-20260730150650-7f] |
| FEAT-20260730150659-74 | Validate ADR/DDR id before supersede | KEEP | Explicit open TODO in ADR-20260730134500-2c; low-effort guard [feature-20260730150659-74] |
| FEAT-20260730150709-cf | Incremental-window validation harness | KEEP | No repeatable verification path exists today; prerequisite for safe prompt changes [feature-20260730150709-cf] |
| FEAT-20260730150718-3e | Window-only prompt variant | DEFER | Source: "revisit only if shared-addendum regresses whole-session or backfill extraction; not needed otherwise" [feature-20260730150718-3e] |
| FEAT-20260802190757-2d | Fix vcc_compact rendering quality | KEEP | Data-safety tag; explicit precondition before re-enabling post-extraction shrink [feature-20260802190757-2d] |
| FEAT-20260805151847-3d | Hash-based skip on re-embedding | KEEP | Clear performance win; bounded implementation; must precede FEAT-ae reindex [feature-20260805151847-3d] |
| FEAT-20260805151847-4c | Reorder-then-compress | KEEP | Targets documented "lost in the middle" degradation; single-file change [feature-20260805151847-4c] |
| FEAT-20260805151847-56 | Per-skill memory scope | KEEP | FEAT-006 dependency already implemented; additive on top of shipped scope system [feature-20260805151847-56, answers q-005] |
| FEAT-20260805151847-5a | Loop-prevention memory | KEEP | Novel write convention grounded in external prior art; no grounds to drop [feature-20260805151847-5a] |
| FEAT-20260805151847-68 | Tunable hybrid search weight | KEEP | Fixed RRF_K is a known simplification; spike needed to confirm whether tuning helps [feature-20260805151847-68] |
| FEAT-20260805151847-77 | Reduced-dimension embeddings | KEEP | If mxbai supports Matryoshka truncation: low-cost storage/speed win; spike needed [feature-20260805151847-77] |
| FEAT-20260805151847-7e | Cosine zero-shot classification | KEEP | Mechanism fits the embedding stack already in place; could replace specific Haiku call sites [feature-20260805151847-7e] |
| FEAT-20260805151847-81 | Compound attribute filters | KEEP | Extends existing nexus_search; clearly scoped to MCP layer [feature-20260805151847-81] |
| FEAT-20260805151847-8e | Query rewriting before embedding | KEEP | Clear recall improvement at input side; targets ADR-009 path [feature-20260805151847-8e] |
| FEAT-20260805151847-ae | Contextual retrieval indexing | KEEP | Directional evidence for recall improvement; nexus already has BM25+RRF+reranking so only the prepend step is missing; external benchmark figures require Nexus-specific validation [feature-20260805151847-ae] |
| FEAT-20260805151847-bd | Averaged session/project embeddings | KEEP | Needs spike; plausible governance signal; no grounds to drop [feature-20260805151847-bd] |
| FEAT-20260805151847-ce | Formal 3-axis quality rubric | KEEP | Needs spike; addresses real limitation of single-signal effectiveConfidence [feature-20260805151847-ce] |
| FEAT-20260805151847-d1 | Typed metadata retrieval filters | KEEP | Needs spike; could complement FEAT-81; no grounds to drop [feature-20260805151847-d1] |
| FEAT-20260805151847-eb | Constrained decoding | KEEP (conditional on FEAT-2a positive outcome) | Gated on FEAT-2a local model serving spike; if FEAT-2a concludes local serving is not feasible, FEAT-eb has zero applicability [feature-20260805151847-eb] |
| FEAT-20260805151848-2a | Local model co-residency/routing | KEEP | Infrastructure prerequisite for FEAT-eb; needs spike [feature-20260805151848-2a] |

**Summary: 24 KEEP, 2 DEFER (FEAT-004, FEAT-20260730150718-3e), 0 DROP.**

---

## Sequencing Recommendation

### Within-bucket ordering

Priority driver: value to active workflows. Needs-research features get a spike step first, inline.

**Capture/Extraction Tuning (vcc_compact):**
1. FEAT-20260802190757-2d — fix vcc_compact rendering (data-safety precondition; unblocks post-extraction shrink re-enable)
2. FEAT-20260730150709-cf — validation harness (must baseline before any SYSTEM_PROMPT changes land)
3. FEAT-20260730150641-ad — phase-section-cue tuning (after harness in place)
4. FEAT-20260730150650-7f — raise MAX_CANDIDATES (after FEAT-ad ships)
5. FEAT-20260730150718-3e — DEFER; no sequencing slot

**Retrieval & Recall:**
1. FEAT-20260805151847-3d — hash-based skip on re-embedding (**must land before FEAT-ae reindex** to avoid re-embedding unchanged memories at full cost when the context-header corpus reindex runs)
2. FEAT-20260805151847-ae — contextual retrieval indexing (FEAT-3d prerequisite must be in place; see FEAT-ae section for benchmark caveat)
3. FEAT-20260805151847-8e — query rewriting (addresses recall at the input side)
4. FEAT-20260805151847-4c — reorder-then-compress (single-file change; immediate daily value)
5. FEAT-002 — jina-reranker-v3 evaluation (bounded evaluation step)
6. FEAT-20260805151847-81 — compound attribute filters (MCP layer extension)
7. FEAT-20260805151847-68 — tunable hybrid search weight (spike before implementation decision)
8. FEAT-20260805151847-77 — reduced-dimension embeddings (spike before implementation decision)
9. FEAT-20260805151847-d1 — typed metadata retrieval filters (spike; coordinate with FEAT-81)
10. FEAT-20260805151847-bd — averaged session/project embeddings (spike; most exploratory in bucket)

**Memory Lifecycle & Governance:**
1. FEAT-20260730150659-74 — validate ADR/DDR id before supersede (explicit open TODO; single call-site change)
2. FEAT-005 — gate promotions by hit_count (low-effort WHERE-clause filter)
3. FEAT-20260805151847-ce — formal 3-axis quality rubric (spike first; longer-horizon change)

**Capture Identity & Guardrails:**
1. FEAT-001 — secret-redaction guard (confirmed safety gap; no content filter exists today [feature-001])
2. FEAT-003 — non-git slug fallback (correctness gap; needs decision before implementation)

**Scope & Filtering:**
1. FEAT-20260805151847-56 — per-skill scope (spike first; FEAT-006 dependency already shipped)
2. FEAT-20260805151847-5a — loop-prevention memory (spike first; can parallel with FEAT-56)

**Local Inference Infra:**
1. FEAT-20260805151848-2a — local model co-residency/routing (prerequisite for FEAT-eb; spike first)
2. FEAT-20260805151847-7e — cosine zero-shot classification (can spike in parallel with FEAT-2a)
3. FEAT-20260805151847-eb — constrained decoding (gated on FEAT-2a outcome; see Fit Check conditional verdict)

### Cross-bucket priority

**Recommended first wave: Capture Identity & Guardrails + Capture/Extraction Tuning (vcc_compact).**

The stated priority driver is value to active workflows. Two inputs shape the wave-1 call:

- **FEAT-001 (secret-redaction guard)** is a confirmed safety/correctness gap with no existing mitigation — no content-safety filter exists anywhere on the capture path today. Letting sessions run without it means any pasted secret or credential that reaches transcript is at risk of permanent persistence. This is not a speculative risk; it is a confirmed absent control. Safety gaps that are cheap to close should not wait behind recall improvements. [feature-001, answers.json q-001, q-009]
- **Capture/Extraction Tuning (vcc_compact)** addresses active correctness issues on the vcc_compact path. FEAT-2d (rendering quality) is a `data-safety`-tagged precondition blocking re-enablement of post-extraction shrink; FEAT-cf (validation harness) is the prerequisite for safe prompt changes. These are correctness blockers, not speculative improvements. [feature-20260802190757-2d, feature-20260730150709-cf]

**Recommended second wave: Retrieval & Recall.** Once the capture path is correct and safe, improving recall quality delivers the highest day-to-day workflow impact across all active sessions. [answers.json q-001]

**Remaining buckets (Memory Lifecycle & Governance, Scope & Filtering, Local Inference Infra)** follow in parallel or sequence as capacity allows, with Local Inference Infra last given its spike-gated and prerequisite-heavy nature.

This ordering is a recommendation, not a hard constraint. Individual high-confidence, low-effort items from later buckets (e.g. FEAT-74, FEAT-005, FEAT-4c) may be pulled forward opportunistically without invalidating the wave structure.

---

## Pending / Follow-up

TODO: Resolve the ADR numbering/index collision: `adr-015-disable-vcc-post-extraction-shrink-in-reflectorts.md` is the authoritative disable-shrink decision file, but architecture.md's index currently labels a different, unrelated ADR as "ADR-015" (adr-20260730134500-2c, supersede-insert reference-upgrade). Use the `add-adr` skill or doc-maintenance tooling to fix the index. This is a doc hygiene issue separate from FEAT-2d's implementation work. [gap-report.json inconsistencies]
