# Architecture: Bound nexus_distill to handle large memory sets

## Components

### distillMemories (src/core/distill.ts)
**Responsibility:** Owns the bounded, optionally-scoped distillation run — selecting the eligible candidate pool, reusing stored vectors, clustering/merging/sanitizing within the bound, and reporting remaining work.
**Interface:**
```
# Public API — new optional params are additive; omitting all of them
# reproduces today's behavior except the embedding-reuse fix.
interface DistillOptions {
	project?: string   # project slug to scope to; literal "global" targets the global bucket
	cwd?: string       # used to derive project slug when project is omitted (same as nexus_backfill)
	limit?: number     # max candidate memories pulled into the clustering pool (default 200, hard cap 500)
	dryRun?: boolean   # count eligibility only; never call callFn/embedFn
}

interface DistillResult {
	embedded: number
	clusters: number
	merged: number
	created: number
	sanitized: number
	processed: number          # candidate memories actually considered this run (<= limit)
	eligibleRemaining: number  # eligible memories under this scope NOT covered by this run
	scope: string              # resolved scope label: project slug, "global", or "all"
	dryRun: boolean
}

async function distillMemories(
	db: Database,
	opts?: DistillOptions,
	embedFn?: EmbedFn,   # injectable for tests (existing)
	callFn?: CallFn,     # injectable for tests (existing)
): Promise<DistillResult>
```

### nexus_distill MCP tool (src/mcp/server.ts)
**Responsibility:** Owns the MCP surface — declares the new params, resolves project from cwd, forwards to distillMemories, and formats the text response (including remaining-work guidance). Stays non-auto-allowed.
**Interface:**
```
# MCP tool input schema (mirrors nexus_backfill)
{
	project?: string   # optional; "global" for the global bucket
	cwd?: string       # optional; derives project when project omitted
	limit?: number     # optional; default 200, clamped to 500
	dry_run?: boolean  # optional; default false
}
# Returns text: processed/embedded/clusters/merged/created/sanitized counts
# plus "N eligible memories remain under this scope — re-invoke to continue"
# when eligibleRemaining > 0.
```

### Eligible-pool query + vector reuse (internal to distill.ts)
**Responsibility:** Builds the scoped, limited `SELECT` for the candidate pool and, per candidate, reads the existing vector from `memories_vec` instead of re-embedding.
**Interface:**
```
# Internal helpers (not exported)
function buildEligibleQuery(scope: ResolvedScope, limit: number): { sql, params }
function loadStoredVector(db, memoryId): Float32Array | null  # from memories_vec
function countEligible(db, scope): number                     # cheap COUNT(*) under same filter
```

---

## Data Flow

### Bounded scoped distill run
1. `nexus_distill` MCP handler receives `{ project?, cwd?, limit?, dry_run? }`.
2. Handler resolves scope: if `project` given use it (literal `"global"` -> global bucket); else if `cwd` given derive slug via the project-resolution convention; else scope = "all".
3. Handler clamps `limit` (default 200, max 500) and calls `distillMemories(db, opts, embedFn, callFn)`.
4. `distillMemories` runs `embedUnindexedMemories` (unchanged — only embeds memories with NO vector).
5. It builds the eligible pool via `buildEligibleQuery(scope, limit)` — `SELECT ... LIMIT :limit`.
6. For each candidate it calls `loadStoredVector`; on hit it reuses the vector, on miss (should be rare post-step 4) it falls back to `embedFn(m.body)`.
7. It computes `eligibleRemaining = countEligible(scope) - processed`.
8. If `dryRun`, it returns counts now with `clusters/merged/created/sanitized = 0` and no `callFn` invocation.
9. Otherwise it clusters, calls `callFn` per cluster to merge, runs the (now-bounded) sanitize pass over the same pool, and returns the full `DistillResult`.
10. Handler formats text, appending re-invoke guidance when `eligibleRemaining > 0`.

### Redundant-embedding avoidance
1. Clustering loop reaches memory `m`.
2. `loadStoredVector(db, m.id)` returns the stored `memories_vec` row.
3. Loop uses that vector directly — `embedFn` is NOT called for `m`.

---

## Storage

### memories_vec (existing — read only, no schema change)
```
# sqlite-vec virtual table already holding one vector per embedded memory
rowid: INTEGER   # maps to memories.id
embedding: FLOAT[]  # reused by loadStoredVector instead of re-calling Ollama
```

### memories (existing — read only, no schema change)
```
# Eligible-pool filter columns
id: INTEGER
body: TEXT
project: TEXT        # slug; NULL for global-scope memories
scope: TEXT          # 'project' | 'global'
superseded: INTEGER  # 0/1 — excluded when 1
rejected: INTEGER    # 0/1 — excluded when 1
```

Scope filter resolution:
- scope = project slug -> `WHERE project = :slug AND superseded = 0 AND rejected = 0`
- scope = `"global"`   -> `WHERE scope = 'global' AND superseded = 0 AND rejected = 0`
- scope = `"all"`      -> `WHERE superseded = 0 AND rejected = 0`
- all variants append `LIMIT :limit`.

---

## Decisions

### limit default 200, hard cap 500
**Decision:** `limit` defaults to 200 when omitted and is clamped to a maximum of 500.
**Alternatives:** No default (unbounded — the original hang); default = full table; a much smaller default (50).
**Rationale:** 200 keeps a single run's Haiku merge calls and wall-clock bounded while covering enough of a typical project bucket to be useful in one pass; 500 hard cap mirrors the spirit of `nexus_backfill`'s 30-session cap (a firm ceiling a caller cannot exceed). Confirms the design proposal.

### project is optional, not required
**Decision:** An unscoped call is allowed; when `project` and `cwd` are both omitted, scope = "all" but the `limit` default still applies, so the run is still bounded.
**Alternatives:** Require `project` on every call.
**Rationale:** "Safe by default" is delivered by the always-applied `limit`, not by forcing scoping. Requiring `project` would break the existing unscoped call site and the backward-compatible default the success criteria require. Matches the design proposal.

### eligibleRemaining as the remaining-work field
**Decision:** `DistillResult` gains `processed`, `eligibleRemaining`, and `scope`. `eligibleRemaining = countEligible(scope) - processed`, from a cheap `COUNT(*)` under the same filter.
**Alternatives:** Report only a total; report a boolean `hasMore`; a percentage.
**Rationale:** A concrete remaining count lets the caller (and the tool text) decide whether to re-invoke and roughly how many more passes are needed — more actionable than a boolean, cheaper and clearer than a percentage. Names sit alongside the existing `embedded/clusters/merged/created/sanitized` fields.

### global handled as an explicit scope value, not auto-merged
**Decision:** Project-scoping matches on the `project` column equality. Global-scope memories are NOT auto-included in a project-scoped run; the literal `project: "global"` selects the global bucket (`scope = 'global'`) as its own scoped run.
**Alternatives:** Fold `scope = 'global'` memories into every project run (`project = :slug OR scope = 'global'`); ignore global memories entirely.
**Rationale:** Keeps each run's eligible pool disjoint and predictable, keeps `eligibleRemaining` accurate per bucket, and treating `"global"` as just another scope slug is the minimal, flat convention consistent with how project slugs are resolved elsewhere. Global memories are still distillable — the caller targets them explicitly.

### Tool stays non-auto-allowed
**Decision:** No new param changes the tool's non-allowlistable status; `dry_run` still triggers no LLM calls but the tool as a whole remains explicit-invoke only.
**Alternatives:** Mark `dry_run: true` calls as auto-allowed since they make no LLM calls.
**Rationale:** Goal explicitly requires the tool never become auto-runnable; a single consistent gate is simpler than per-param allowlist logic.

---

## Open Questions
<!-- These must be resolved before /plan runs. Planner will fail if ambiguous. -->
- None. All four design Key Questions are resolved above. The one item to confirm during implementation (not blocking): the exact project-resolution helper name used by `nexus_backfill` in server.ts, to reuse verbatim rather than reimplement the cwd->slug derivation.
