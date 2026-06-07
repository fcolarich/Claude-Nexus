# Claude Nexus — Phase 2 Gaps Spec

**Project:** `C:\Fran\claude-nexus`  
**Status:** Pending. Implement AFTER corpus expansion (Features 1–4) is complete and stable.  
**Predecessor:** `Claude Nexus - Corpus Expansion Spec.md`

---

## Context

Gap analysis against external 2026 memory system research (Mem0, Zep, MemGPT, Letta) and the master-tooling-reference.md evaluation. Items here are not covered by the Corpus Expansion Spec.

Gaps ranked: **Critical** (correctness/safety) → **Important** (quality gap vs industry) → **Moderate** (nice-to-have).

---

## Critical Gaps

### Gap 1 — Hybrid Retrieval in Recall Path

**Problem:** `src/core/recall.ts` uses only FTS5 full-text search (or full confidence-sorted scan when no query). Zero vector retrieval. Zero BM25+RRF. Industry standard (Mem0, Zep) is triple-stream fusion: BM25 + dense vector + graph traversal → RRF → cross-encoder rerank.

**Impact:** Conceptually similar memories with no keyword overlap are never surfaced. A query for "auth token expiry" won't find a memory titled "JWT validation window off-by-one" even if the vector similarity is 0.91.

**Fix — `src/core/recall.ts`:**

```
1. Add vector path: embed query → sqlite-vec KNN on memories_vec → top-K by similarity
2. Add BM25 path: build in-memory BM25 corpus from all non-superseded memories → score against query tokens
3. RRF merge: same rrfMerge() from src/core/links.ts (reuse, don't duplicate)
4. Cross-encoder rerank (optional): if wink-bm25 already installed and results > threshold, run a second LLM pass to rerank top-10 to top-5. Low priority — RRF alone is a large improvement.
```

Constants to introduce:
```ts
const RECALL_TOP_K = 20;   // candidates per retrieval leg before RRF
const RECALL_FINAL_K = 8;  // after RRF, before max_tokens truncation
```

The existing `effectiveConfidence(m) * helpRate` scoring applies AFTER RRF reranking — use it as a tie-breaker or filter (drop results below `recall.min_confidence: 0.35`).

**Files:** `src/core/recall.ts` only. `rrfMerge` already exists in `src/core/links.ts` — import it.

---

### Gap 2 — Graph Traversal at Recall Time

**Problem:** `atom_links` is populated by auto-linking (Feature 3, Corpus Expansion Spec) but never consulted during recall. A memory retrieved by vector similarity could have first-degree `supports`/`references`/`extends` links to related atoms that are not in the top-K vector results.

**Fix — `src/core/recall.ts`:**

After RRF merge, for each result in top-K:
```ts
// Expand by one hop via atom_links
const linked = db.prepare(`
  SELECT target_id, link_type, confidence
  FROM atom_links
  WHERE source_id = ? AND link_type IN ('supports', 'references', 'extends')
  ORDER BY confidence DESC LIMIT 3
`).all(memoryId);
// Add linked items to candidate pool with a fixed RRF rank penalty (e.g. rank = RECALL_TOP_K)
```

One-hop only. No recursive expansion — prevents graph blowup. Penalty rank ensures direct hits still outrank graph-expanded hits.

**Files:** `src/core/recall.ts`.

---

### Gap 3 — Contradiction Flag at Recall Time

**Problem:** When recall returns two memories that have a `contradicts` link between them (populated by `nexus_distill` or `nexus_analyze`), the caller has no signal that the information is in conflict.

**Fix — `src/core/recall.ts`:**

After collecting final results, check for contradicts links within the result set:
```ts
const ids = results.map(r => r.id);
const conflicts = db.prepare(`
  SELECT source_id, target_id FROM atom_links
  WHERE link_type = 'contradicts'
    AND source_id IN (${placeholders})
    AND target_id IN (${placeholders})
`).all(...ids, ...ids);
```

If conflicts found, add a `_conflicts: [{ a: id, b: id }]` field to the recall response. The MCP layer surfaces this as a warning note in the `nexus_recall` response.

**Files:** `src/core/recall.ts`, `src/mcp/server.ts` (response shaping).

---

### Gap 4 — Secrets / PII Filter in Transcript Processing

**Problem:** `src/capture/transcript.ts` strips tool results to 200 chars (`TOOL_RESULT_CAP`) but has no pattern-based filter for API keys, tokens, passwords, emails, or PII that may appear in user messages or assistant turns.

**Fix — `src/capture/transcript.ts`:**

Add a `redactSecrets(text: string): string` function applied to every user/assistant message before passing to the LLM extraction call:

```ts
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/g,              // Anthropic/OpenAI API keys
  /ghp_[A-Za-z0-9]{36}/g,             // GitHub PATs
  /(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}/gi,  // emails
];

function redactSecrets(text: string): string {
  let out = text;
  for (const pat of SECRET_PATTERNS) out = out.replace(pat, '[REDACTED]');
  return out;
}
```

Apply before the batch passed to `extractMemories()` in `src/capture/extract.ts`.

**Files:** `src/capture/transcript.ts`, optionally `src/capture/extract.ts`.

---

## Important Gaps

### Gap 5 — Missing Memory Types: `episodic` and `procedural`

**Problem:** Current 9-type enum covers what was learned (semantic) but not:
- **episodic**: narrative of what happened in a session — compressed story, not extracted facts. What Letta calls "event memory."
- **procedural**: how to do recurring tasks — multi-step recipes. Closer to a SKILL.md but stored in the memory store with confidence decay.

**Fix — `src/core/types.ts`:**

```ts
export type MemoryType = 
  | 'preference' | 'convention' | 'failure' | 'correction'
  | 'decision' | 'insight' | 'tool_quirk' | 'reference' | 'handoff'
  | 'episodic'    // compressed session narrative, one per session
  | 'procedural'; // how-to recipe, decay_class: 'implementation'
```

**Episodic capture** — new hook: on `Stop` hook fire, if session has ≥ 4 exchanges and was not already captured, extract a single episodic memory: `"Session {date}: {1-sentence summary of what was done, what worked, what didn't}"`. Target: ~100 tokens. Stored with `scope: project`, `decay_class: implementation`, confidence decays at `0.01/day`.

**Procedural capture** — via `nexus_remember` explicit call only. No automatic extraction. Confidence starts at 0.7, rises on `use_count` increments same as other types.

**Files:** `src/core/types.ts`, new `src/capture/stop-hook.ts`, `src/mcp/server.ts` (nexus_remember validation).

---

### Gap 6 — Auto-Pruning: `nexus_prune`

**Problem:** No automatic eviction of low-confidence, stale memories. Over time, the store accumulates junk. Mem0 has TTL eviction; Zep has `inactive_threshold`.

**Fix — new MCP tool `nexus_prune`:**

```
Input:  { dry_run?: boolean, min_confidence?: number, days_inactive?: number }
Output: { pruned: number, kept: number, list?: Memory[] }
```

Eviction criteria (AND logic — all must be true):
```sql
WHERE effective_confidence < (min_confidence ?? 0.30)
  AND use_count = 0
  AND last_verified_at < datetime('now', '-' || days_inactive || ' days')
  AND superseded_by IS NOT NULL
```

`dry_run = true` returns list without deleting. Default: `min_confidence=0.30`, `days_inactive=90`.

Also add a scheduled auto-prune: after each `nexus_distill` run, call prune with defaults silently. Log count to stderr.

**Files:** `src/mcp/server.ts` (new tool), `src/core/memories.ts` (prune query).

---

### Gap 7 — Temporal Query Interface

**Problem:** `nexus_recall` and `nexus_search` have no date-range filtering. Can't ask "what did I learn last week?" or "decisions made before the architecture change on 2026-04-01."

**Fix — extend existing tools:**

`nexus_recall` / `nexus_search` inputs: add optional `since?: string` (ISO date), `before?: string` (ISO date).

```sql
-- Append to existing WHERE clause:
AND created_at >= (since ?? '1970-01-01')
AND created_at < (before ?? '9999-12-31')
```

`nexus_sessions` already returns date ranges — temporal filtering makes `nexus_recall` composable with it.

**Files:** `src/mcp/server.ts` (input schema), `src/core/recall.ts` (query building).

---

## Moderate Gaps

### Gap 8 — Mental Models / Living Documents

**Problem:** Some knowledge is not a fact but a model — a structured belief about how something works that should update incrementally as new evidence arrives. Example: "my understanding of how Nexus distill works." Neither atomic memory nor atom (file-mirrored) fits perfectly.

**Approach:** Don't add a new storage type. Instead:
- Memory type `insight` with `scope: global` and `decay_class: stable` approximates this.
- Add guidance to the system prompt in `extract.ts`: when extracting structural understanding of a tool or pattern, use `memory_type: insight`, `scope: global`, `decay_class: stable`.
- When a new insight about the same topic arrives, the `correction` type with `supersedes` handles the update.

No code change needed — this is a prompt tuning and usage pattern fix.

**Files:** `src/capture/extract.ts` (system prompt addition only).

---

### Gap 9 — PostToolUse Observation Capture

**Problem:** The capture pipeline fires on session Stop (batch) or manually. Tool errors are already signals (`toolErrors > 0` in `hasSignal`). But successful tool patterns — "this grep pattern always returns empty, try rg instead" — are never captured as tool_quirk memories.

**Fix:** In `transcript.ts`, expand the tool error signal to also fire on tool result patterns:
```ts
// Add to hasSignal check:
const toolPatterns = extractToolPatterns(events);
// e.g. repeated identical tool → empty result sequences
hasSignal = hasSignal || toolPatterns.length > 0;
```

Low priority. Only implement if transcript quality remains poor after Gap 4 (secrets) is fixed.

**Files:** `src/capture/transcript.ts`.

---

### Gap 10 — Entity Resolution

**Problem:** "GitNexus", "claude-nexus", "Nexus" can be three names for the same entity. No normalization layer means memory searches fragment across name variants.

**Approach:** Lightweight alias table in the DB:
```sql
CREATE TABLE IF NOT EXISTS entity_aliases (
  canonical TEXT NOT NULL,
  alias TEXT NOT NULL PRIMARY KEY
);
```

At recall time, expand the query by substituting known aliases before BM25 tokenization.

Populated manually via a `nexus_alias` MCP tool (no auto-detection — entity detection requires NLP infrastructure not justified at current scale).

Low priority. FTS5 handles partial token matches reasonably. Implement when alias collisions are actually causing recall misses.

**Files:** `src/core/database.ts`, `src/mcp/server.ts`.

---

## Implementation Order

When starting Phase 2:

1. **Gap 1** (hybrid recall) — largest quality delta, builds on links.ts from Feature 3
2. **Gap 2** (graph traversal at recall) — requires Feature 3 to be populated first
3. **Gap 3** (contradiction flag) — requires atom_links populated; small change
4. **Gap 4** (secrets filter) — safety, independent, do early
5. **Gap 5** (episodic type + stop hook) — medium effort, high value for session-level memory
6. **Gap 6** (nexus_prune) — maintenance, low urgency
7. **Gap 7** (temporal query) — small, high composability value
8. **Gaps 8–10** — optional, implement only if gaps 1–7 don't resolve the identified issues

---

## Test Coverage Needed

- `src/core/recall.test.ts` — hybrid path: vector miss + BM25 hit surfaces correct memory; RRF merge order
- `src/core/recall.test.ts` — graph traversal: direct hit + linked hit both returned; linked hit ranked lower
- `src/core/recall.test.ts` — contradiction flag: two memories with contradicts link → response includes conflict list
- `src/capture/transcript.test.ts` — secrets redaction: API key, Bearer token, email all replaced with [REDACTED]
- `src/core/memories.test.ts` — prune: dry_run returns list without delete; live run deletes only eligible rows
- Integration: session Stop → episodic memory created with correct type/scope/decay_class
