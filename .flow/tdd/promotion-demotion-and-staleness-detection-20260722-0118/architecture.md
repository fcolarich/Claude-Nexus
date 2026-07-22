# Architecture: Promotion/Demotion & Staleness Detection

Two new phases appended to `consolidateMemories()`:
- **Phase 4 — Help-rate trend governance** (item 6): pure arithmetic over existing counters; adjusts `confidence` on accumulated help-rate trend.
- **Phase 5 — Contradiction candidate detection** (item 7): heuristic pre-filter + bounded Haiku confirmation over the existing `'related'` link band; surfacing-only.

Both are additive, surfacing-only (zero auto-suppression), and reuse existing columns/CHECK values. `src/core/decay.ts` is not touched.

---

## Components

### governance.ts (NEW — `src/core/governance.ts`)
**Responsibility:** Owns the two new consolidation passes — help-rate trend governance and contradiction candidate detection — as standalone, individually testable functions; owns nothing about orchestration or scheduling.
**Interface:**
```
# Public API
import type Database from 'better-sqlite3';
import { callModel } from './llm.js';   // same Haiku path extract.ts uses

export interface GovernResult { demoted: number; reinforced: number; }
export interface ContradictionResult { contradictionsFlagged: number; contradictionPairsChecked: number; }

# Injectable Haiku call — mirrors the embedFn injection pattern (default = real Haiku via llm.ts)
export type HaikuFn = (systemPrompt: string, userPrompt: string) => Promise<string>;

# Phase 4 — pure SQL, no network. Synchronous.
export function governByHelpRate(db: Database.Database): GovernResult;

# Phase 5 — bounded Haiku confirmation. Async because of haikuFn.
export function detectContradictions(
  db: Database.Database,
  haikuFn?: HaikuFn,            # defaults to callModel
): Promise<ContradictionResult>;

# Tuning constants (exported for tests; module-level, not schema, not yaml for now)
export const MIN_EVALUATIONS = 5;
export const LOW_THRESHOLD = 0.3;
export const HIGH_THRESHOLD = 0.8;
export const CONFIDENCE_FLOOR = 0.1;
export const DEMOTE_FACTOR = 0.85;
export const REINFORCE_BUMP = 0.05;
export const DIVERGENCE_CONF = 0.3;
export const MAX_PAIRS_PER_RUN = 20;
```

### consolidate.ts (MODIFIED — `src/core/consolidate.ts`)
**Responsibility:** Orchestrates the periodic cleanup sweep; sequences all five phases and aggregates their counts into one result. Contains no governance/contradiction logic itself — it imports and calls governance.ts.
**Interface:**
```
# Public API — signature gains a third injectable, keeping the embedFn pattern
export interface ConsolidateResult {
  embedded: number;
  merged: number;
  pruned: number;
  demoted: number;                    # NEW (phase 4)
  reinforced: number;                 # NEW (phase 4)
  contradictionsFlagged: number;      # NEW (phase 5)
  contradictionPairsChecked: number;  # NEW (phase 5)
}

export async function consolidateMemories(
  db: Database.Database,
  embedFn?: (text: string) => Promise<Float32Array | null>,  # existing default
  haikuFn?: HaikuFn,                                          # NEW default = callModel
): Promise<ConsolidateResult>;
```

### mcp/server.ts — nexus_consolidate tool (MODIFIED)
**Responsibility:** Exposes the sweep over stdio; reports the five phases' counts to the caller. No new tool is added — folded into the existing tool per the design's explicit decision.
**Interface:**
```
# Unchanged input ({}), extended output text:
# "Consolidation complete: N embedded, N merged, N pruned,
#  N demoted, N reinforced, N contradiction pair(s) checked (N flagged)."
r = await consolidateMemories(db)   # haikuFn/embedFn use real defaults
```

### llm.ts — callModel (REUSED, unchanged)
**Responsibility:** The single Haiku call site (provider-aware, `claude-agent-sdk`/OpenAI-compatible). Reused verbatim as the default `HaikuFn`.
**Interface:**
```
export function callModel(systemPrompt: string, userPrompt: string): Promise<string>;
```

---

## Data Flow

### Phase 4: governByHelpRate (per consolidateMemories call)
1. `consolidateMemories` calls `governByHelpRate(db)` after the existing merge phase.
2. `governByHelpRate` selects candidate rows:
   `SELECT id, confidence, use_count, help_count FROM memories
    WHERE review_status='approved' AND superseded_by IS NULL AND use_count >= MIN_EVALUATIONS`.
3. For each row it computes `helpRate = help_count / use_count` and picks a branch:
   - `helpRate < LOW_THRESHOLD` → **demote**: `confidence = MAX(FLOOR, confidence*0.85)`, reset counts. `last_verified_at` untouched.
   - `helpRate > HIGH_THRESHOLD` → **reinforce**: `confidence = MIN(1.0, confidence+0.05)`, `last_verified_at = datetime('now')`, reset counts.
   - between → **dead zone**: reset counts only (window consumed, no confidence/verify change).
4. All branches set `use_count=0, help_count=0, updated_at=datetime('now')` so the next window is judged fresh (trend, not lifetime average).
5. Returns `{ demoted, reinforced }` to `consolidateMemories`.

### Phase 5: detectContradictions (per consolidateMemories call)
1. `consolidateMemories` calls `detectContradictions(db, haikuFn)` as the final phase.
2. **Shortlist (SQL, no LLM).** Join `memory_links (link_type='related')` to both endpoint memories; keep only approved, non-superseded, same `scope`, same `project`, that pass the divergence pre-filter `ABS(a.confidence-b.confidence) > 0.3 OR a.decay_class != b.decay_class`, and that do **not** already have a `contradicts` link in either direction. Order `l.created_at ASC`, `LIMIT MAX_PAIRS_PER_RUN`.
3. For each shortlisted pair, build a yes/no prompt and call `haikuFn(system, user)`; parse a structured `{ conflict: boolean, reason: string }`.
4. **On `conflict=true`:** `INSERT OR IGNORE` a `memory_links` row `link_type='contradicts'` (write both directions so `nexus_crossref`'s source-side lookup finds it either way), then materialize one `diagnostics` row (`type='stale'`, `atom_id=NULL`, `details` JSON `{reason:'contradiction', memory_ids:[a,b], haiku_reason}`) if an equivalent one does not already exist.
5. **On `conflict=false` / parse failure / `haikuFn` throws:** skip silently — no write. "Couldn't check" is never "contradiction."
6. **Self-heal step (idempotent, every run):** re-derive contradiction diagnostics from the durable `contradicts` links — for each `contradicts` link lacking a matching `type='stale'` contradiction diagnostic, insert one. This repairs diagnostics that `decay.ts:flagStaleMemories` wiped between runs (see Decisions).
7. Returns `{ contradictionsFlagged, contradictionPairsChecked }`.

### End-to-end
1. `nexus_consolidate` → `consolidateMemories(db)`.
2. Phases run in order: backfill embeddings → prune rejected → merge near-dups → `governByHelpRate` → `detectContradictions`.
3. Aggregated `ConsolidateResult` returned; MCP tool formats the report string.
4. Flagged pairs surface through unchanged tools: `nexus_health` (`diagnosticsByType.stale`) and `contradicts` links in the graph. A human decides resolution.

---

## Storage

No new tables, columns, or CHECK values. All writes target existing shapes.

### memories (existing — UPDATE only, phase 4)
```
confidence:       REAL   # demote *0.85 (floor 0.1) / reinforce +0.05 (cap 1.0)
use_count:        INTEGER # reset to 0 after every evaluation
help_count:       INTEGER # reset to 0 after every evaluation
last_verified_at: TEXT   # refreshed ONLY on reinforce; untouched on demote/dead-zone
updated_at:       TEXT   # datetime('now') on any branch
```

### memory_links (existing — INSERT OR IGNORE, phase 5)
```
source_id:  TEXT
target_id:  TEXT
link_type:  'contradicts'   # already permitted by CHECK; never written before this feature
confidence: REAL = 1.0
# UNIQUE(source_id, target_id, link_type) — dup-safe; two rows written (both directions)
# ORDERING for shortlist uses the existing 'related' row's created_at (no per-pair "checked" column exists)
```

### diagnostics (existing — INSERT, phase 5; derived/self-healing)
```
type:    'stale'   # reused CHECK value — surfaces in nexus_health.diagnosticsByType with zero tool changes
atom_id: NULL
message: "Contradiction candidate: <title A> vs <title B>"
details: JSON { reason: 'contradiction', memory_ids: [idA, idB], haiku_reason: string }
# NOT the durable record — the 'contradicts' memory_links row is. This is a re-derivable surfacing artifact.
```

---

## Decisions

### KQ1 — Module placement: new `governance.ts`
**Decision:** Put `governByHelpRate` and `detectContradictions` in a new `src/core/governance.ts`; `consolidate.ts` imports and sequences them.
**Alternatives:** Inline both into `consolidate.ts`.
**Rationale:** `consolidate.ts` is ~120 lines, cohesive around embedding/prune/dedup. Phase 5 alone adds a Haiku system prompt, response parser, shortlist SQL, and link/diagnostic writes — inlining would roughly triple the file and mix a network-calling judgment pass with the existing pure-SQL sweep. A separate module keeps `consolidate.ts` an orchestrator and isolates the two passes for unit testing (inject a fake `HaikuFn`, assert counts). Matches the project's "controllers thin, logic in services" convention.

### KQ2 — Haiku plumbing: inject a low-level `HaikuFn` parameter
**Decision:** Add `haikuFn: (system, user) => Promise<string> = callModel` as a third parameter to `consolidateMemories`, passed through to `detectContradictions`. Prompt construction and JSON parsing live in `governance.ts`.
**Alternatives:** (a) Import the extraction client / `callModel` directly inside `detectContradictions` with no injection. (b) Inject a high-level judge `(a,b) => Promise<{conflict,reason}>`.
**Rationale:** Mirrors the existing `embedFn` injection exactly (embedFn is the low-level `text→vector`; HaikuFn is the low-level `prompts→string`), so tests fake the boundary the same way the rest of the codebase already does. `callModel` from `core/llm.js` is the same provider-aware path `extract.ts` uses — no new client. Keeping the function low-level (not a pre-baked judge) keeps prompt/parse logic co-located and version-controlled in `governance.ts` where it can evolve, while still being fully testable via canned string returns.

### KQ3 — MAX_PAIRS_PER_RUN ordering & re-check cost: accept repeat cost, no new schema
**Decision:** Do **not** add schema to track "already cleared" pairs. A `conflict=false` result writes nothing, so a still-related, still-divergent pair is re-shortlisted and re-checked on future runs. Mitigate cost with four levers, all zero-schema: (1) the divergence pre-filter shrinks the candidate set; (2) `MAX_PAIRS_PER_RUN=20` caps per-run Haiku spend and drains a backlog over several runs; (3) pairs that already carry a `contradicts` link are excluded from the shortlist via `NOT EXISTS`, so **confirmed** contradictions never re-cost; (4) deterministic `ORDER BY related.created_at ASC` drains the same bounded set predictably. Only not-yet-flagged related+divergent pairs incur repeat cost, bounded by the cap.
**Alternatives:** (a) Abuse the existing `'related'` link's `confidence` field as a "checked/cleared" sentinel — rejected: corrupts a field other code reads. (b) Write a "cleared" marker as a new `memory_links.link_type` or `diagnostics.type` — rejected: both require a CHECK-constraint change (table-rebuild migration), violating the no-schema constraint. (c) Add a nullable `memories.contradiction_checked_at` / dedicated diagnostics type now.
**Rationale:** This is the one place the design flagged the constraint might need revisiting — explicit call: **the no-schema constraint holds for this pass.** At expected per-bucket volumes the shortlist after divergence-filtering is small and the cap bounds worst-case spend; `consolidate` is a manual/periodic sweep, not a hot path. **Explicit revisit trigger:** if `contradictionPairsChecked` consistently saturates `MAX_PAIRS_PER_RUN` across consecutive runs (backlog never drains), that is the signal to add a minimal `memories.contradiction_checked_at` column (or a dedicated diagnostics type) in a follow-up migration + DDR. Until that signal appears, repeat cost is accepted.

### KQ4 — DDR timing for item 7: after `/plan`, before `/execute`
**Decision:** Author the contradiction-detection DDR (heuristic pre-filter + bounded Haiku confirmation + surfacing-only, never auto-suppress) via the `add-ddr` skill **after `/plan` completes and before `/execute` touches any contradiction-detection file.**
**Alternatives:** Write the DDR after implementation, or skip it.
**Rationale:** The synthesis makes the DDR a hard pre-merge gate because of false-positive risk (surfacing a valid memory as contradictory). Writing it after `/plan` means the design is locked before the risky code exists; writing it after `/execute` makes it an afterthought that can't shape the code. Phase 4 (help-rate governance) is pure arithmetic with no false-positive/suppression risk and needs no DDR gate — only phase 5 does.

### Diagnostics collision with decay.ts (constraint-driven)
**Decision:** Treat the `contradicts` `memory_links` row as the **durable** record of a flagged pair; treat the `type='stale'` diagnostics row as a **re-derivable surfacing artifact**. `detectContradictions` re-materializes contradiction diagnostics from `contradicts` links on every run (data-flow step 6).
**Alternatives:** Give contradiction diagnostics a distinct `diagnostics.type` so `flagStaleMemories` skips them; modify `flagStaleMemories`'s `DELETE` to spare them.
**Rationale:** `decay.ts:flagStaleMemories` runs `DELETE FROM diagnostics WHERE type='stale'` then re-inserts only decayed-memory rows — it would silently wipe contradiction diagnostics, and since a flagged pair is excluded from re-shortlisting (it already has a `contradicts` link), the Haiku loop would never rewrite them. Both escape hatches require editing `decay.ts` or adding a CHECK value — both forbidden. Making the link the source of truth and re-deriving the diagnostic each consolidate run yields eventual consistency without touching `decay.ts` or the schema. Both artifacts are surfacing-only, so transient loss between a `flagStaleMemories` run and the next `consolidate` is acceptable.

---

## Open Questions
<!-- These must be resolved before /plan runs. Planner will fail if ambiguous. -->
- None. All four Key Questions from the design are resolved above; the diagnostics/decay collision is resolved via the re-derivation decision. Remaining tuning values (thresholds, `MAX_PAIRS_PER_RUN`) ship as module constants with the design's stated defaults and are not blocking.
