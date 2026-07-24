# Implementation Spec: Bound nexus_distill for large memory sets

## Implementation approach

Additive, backward-compatible change to `distillMemories()` (`src/core/distill.ts`) and its MCP wrapper (`src/mcp/server.ts`). Omitting all new options reproduces today's behavior except the embedding-reuse fix.

Work proceeds strictly in dependency order so the build stays green after every task: interfaces + signature first, then pure query/scope helpers (unit-testable in isolation), then wire those helpers into the existing clustering loop plus result accounting, then the embedding-reuse bug fix, then `dry_run` and the sanitize bound, then the MCP surface, then a backward-compat regression pass.

Implementation decisions that go beyond the architecture doc and must be honored:

- **Signature ripple.** The architecture fixes the order as `distillMemories(db, opts?, embedFn?, callFn?)` — `opts` is inserted at position 2, shifting the existing `embedFn`/`callFn`. Every existing positional caller (the `nexus_distill` handler in `server.ts` and all `distill.test.ts` calls) must be updated in the *same* commit that changes the signature, passing `undefined`/`{}` for `opts`, so positional args stay aligned and the build + existing suite stay green. This is the only cross-file step; everything after it is localized to one file.
- **Authoritative clamp lives in `distillMemories`.** `limit` is normalized (`limit ?? 200`, clamped to `[1, 500]`) inside `distillMemories`, at the point it is applied to the pool query, because the success-criteria tests call `distillMemories` directly and rely on the default/cap. The MCP handler also normalizes its input per the architecture, but the load-bearing guarantee is in `distillMemories`.
- **`dry_run` short-circuits before `embedUnindexedMemories`.** The contract is "never call `embedFn`". `embedUnindexedMemories` calls `embedFn`, so a dry run must return counts *before* that step: resolve scope → `countEligible` → compute `processed`/`eligibleRemaining` → return with every LLM/embedding-derived count zero. This tightens the architecture's data-flow ordering (which lists the embed step first); the stronger "never call `embedFn`" wording wins.
- **Snapshot semantics for `eligibleRemaining`.** `countEligible(scope)` is read at the same point the pool is built (snapshot of currently-eligible rows) and `eligibleRemaining = countEligible - processed`. Because the pool is `LIMIT :limit` over the identical filter, `processed <= countEligible`, so the field is always ≥ 0. It is an estimate of "how many more passes", per the design.

## Interface contracts

Implementers read only the files listed on their task plus this spec. The contracts below are the source of truth for those tasks.

```ts
interface DistillOptions {
	project?: string   // project slug to scope to; literal "global" targets the global bucket
	cwd?: string       // derive project slug when project is omitted (same helper as nexus_backfill)
	limit?: number     // max candidate memories pulled into the clustering pool (default 200, hard cap 500)
	dryRun?: boolean   // count eligibility only; never call callFn or embedFn
}

interface DistillResult {
	embedded: number
	clusters: number
	merged: number
	created: number
	sanitized: number
	processed: number          // candidate memories considered this run (<= limit)
	eligibleRemaining: number  // eligible memories under this scope NOT covered by this run
	scope: string              // resolved scope label: project slug, "global", or "all"
	dryRun: boolean
}

async function distillMemories(
	db: Database,
	opts?: DistillOptions,
	embedFn?: EmbedFn,   // injectable for tests (existing)
	callFn?: CallFn,     // injectable for tests (existing)
): Promise<DistillResult>
```

Internal helpers (not exported):

```ts
type ResolvedScope = { kind: "project"; slug: string } | { kind: "global" } | { kind: "all" }

function resolveScope(opts: DistillOptions | undefined): ResolvedScope
function buildEligibleQuery(scope: ResolvedScope, limit: number): { sql: string; params: Record<string, unknown> }
function countEligible(db: Database, scope: ResolvedScope): number
function loadStoredVector(db: Database, memoryId: number): Float32Array | null
```

Scope filter (all read-only against existing `memories`; `LIMIT :limit` appended only by `buildEligibleQuery`, never by `countEligible`):

- project slug → `WHERE project = :slug AND superseded = 0 AND rejected = 0`
- `"global"`   → `WHERE scope = 'global' AND superseded = 0 AND rejected = 0`
- `"all"`      → `WHERE superseded = 0 AND rejected = 0`

`loadStoredVector` reads the existing sqlite-vec table `memories_vec` (`rowid` maps to `memories.id`, column `embedding FLOAT[]`); no schema change.

MCP tool input schema (mirrors `nexus_backfill`): `{ project?: string, cwd?: string, limit?: number, dry_run?: boolean }`. Tool stays non-auto-allowed — no new param changes its explicit-invoke-only status, `dry_run` included.

## Build order and dependencies per component

1. **Types + signature scaffold** (`distill.ts`, `server.ts`, `distill.test.ts`) — add `DistillOptions`, extend `DistillResult`, change signature to insert `opts` at position 2, update the return object(s) with safe placeholder values (`processed: 0, eligibleRemaining: 0, scope: "all", dryRun: false`), and fix every positional call site. Foundation for everything; no behavior change. No dependency.
2. **Query helpers** (`buildEligibleQuery`, `countEligible`) — pure SQL builders over the scope filter. Depends on (1) only for shared-file ordering.
3. **`resolveScope`** — maps `opts` → `ResolvedScope`; `project` wins, else derive slug from `cwd` via the same helper `nexus_backfill` uses (`resolveProjectSlug` from `src/core/project-root.ts`), else `"all"`; literal `project: "global"` → global scope. Depends on (2).
4. **Scoped/limited pool + accounting** — replace the unbounded `SELECT * FROM memories …` that feeds the clustering loop with `buildEligibleQuery(resolveScope(opts), clampedLimit)`; set `processed`, `scope`, and `eligibleRemaining` on the result; apply the authoritative clamp here. Depends on (3).
5. **Embedding reuse** — add `loadStoredVector`; in the clustering loop use the stored vector when present, fall back to `embedFn(m.body)` only on a miss. Depends on (4) (same loop).
6. **`dry_run` short-circuit** — early return after scope/limit/count, before `embedUnindexedMemories`. Depends on (5).
7. **Sanitize bound** — point the "sanitize verbose singletons" second pass at the same scoped/limited pool instead of a fresh full-table scan. Depends on (6).
8. **MCP schema + handler** (`server.ts`) — declare the four input params, normalize `limit`, resolve/forward `project`/`cwd`, call `distillMemories`, keep non-auto-allowed. Depends on (1); runs in parallel with 2–7.
9. **MCP text + description** (`server.ts`) — format processed/embedded/clusters/merged/created/sanitized, append "N eligible memories remain under this scope — re-invoke to continue" when `eligibleRemaining > 0`; update the tool docstring in `nexus_backfill` style. Depends on (8) and (4).
10. **Backward-compat regression** (`distill.test.ts`) — assert the unscoped `distillMemories(db)` path preserves clustering/merge/sanitize/supersede/link bookkeeping. Depends on (7).

Parallelism: the MCP-schema task (8) shares no files with the `distill.ts` chain (2–7) and only needs the signature from (1), so it runs concurrently with the internals. Everything touching `distill.ts`/`distill.test.ts` serializes because those two files are shared.

## Test strategy per component

- **Types + signature (1):** No new test. Rationale: pure scaffold; correctness is that the project compiles and the existing suite stays green with updated call sites.
- **Query helpers (2):** Unit. Pure functions — assert the exact `sql` and `params` for project/`global`/`all`, and that `countEligible`'s SQL contains no `LIMIT`.
- **`resolveScope` (3):** Unit. Branch coverage: `project` set → `{project, slug}`; `project: "global"` → `{global}`; only `cwd` set → derived slug; neither → `{all}`.
- **Scoped pool + accounting (4):** Unit against a seeded in-memory SQLite DB with mocked `embedFn`/`callFn`. Assert pool ≤ `limit` regardless of table size (SC-3); only project-matching rows are eligible (SC-4); `processed`/`scope`/`eligibleRemaining` values; empty scope → clean zero result, no throw.
- **Embedding reuse (5):** Unit with an `embedFn` spy. Seed memories that all already have stored vectors; assert the clustering loop makes **zero** `embedFn` calls (SC-2); assert a memory lacking a vector still falls back to `embedFn`.
- **`dry_run` (6):** Unit with `callFn` and `embedFn` spies. `dryRun: true` → both spies 0 calls, `clusters/merged/created/sanitized == 0`, `processed`/`eligibleRemaining` populated (SC-5).
- **Sanitize bound (7):** Unit. Assert the sanitize pass touches only the scoped/limited pool — memories outside the scope are never passed to `callFn` and remain unmodified.
- **MCP schema + handler (8):** None. Rationale: thin forwarding controller (project convention: controllers thin, logic in services); all behavior is covered by the `distill.ts` unit tests. Non-auto-allowed status is verified by inspection of the tool registration.
- **MCP text + description (9):** None. Rationale: trivial string assembly; verified by inspection. The `eligibleRemaining > 0` branch is exercised indirectly through the accounting unit tests that produce the field.
- **Backward-compat (10):** Regression unit. Unscoped `distillMemories(db)` reproduces existing clustering/merge/sanitize/supersede/link behavior on a small (< 200) seeded set (SC-6); assert default scope resolves to `"all"` and the default limit is applied without altering small-set outcomes.

## Edge cases and error handling per component

- **Signature ripple (1):** Any positional caller not updated silently passes `embedFn` into the `opts` slot — guard by updating `server.ts` and every `distill.test.ts` call in the same commit; a green existing suite is the check.
- **Limit normalization (4):** `undefined`/`null`/`NaN`/`<= 0` → default 200; `> 500` → clamp to 500; fractional → floor. Normalize once where the pool query is built.
- **Empty / non-matching scope (4):** `project` or `cwd`-derived slug with no rows → pool empty, `processed = 0`, `eligibleRemaining = 0`, no `callFn`/`embedFn` calls, returns a well-formed zero result (never hangs, never throws). This is the bounded-fast-return behavior the design demands.
- **Unresolvable `cwd` (3):** `resolveProjectSlug` returns whatever slug it derives; a slug with no memories degrades to the empty-scope case above — do not special-case or throw.
- **Vector miss (5):** `loadStoredVector` returns `null` (memory embedded after the pool snapshot, or a race) → fall back to `embedFn(m.body)`; expected rare post-`embedUnindexedMemories`.
- **`dry_run` with unindexed memories (6):** Must not embed them — short-circuit before `embedUnindexedMemories`; `embedded` reports 0 for a dry run.
- **`eligibleRemaining` never negative (4):** Guaranteed by `processed <= countEligible` (same filter, pool is `LIMIT`); no clamping needed but the invariant should hold under test.
- **Global vs project disjointness (2,3):** A project-scoped run must NOT include `scope = 'global'` rows; `"global"` is its own scope. Keeps `eligibleRemaining` accurate per bucket.
- **MCP handler (8):** Reject/ignore unknown params gracefully via the schema; `limit` out of range is clamped, not rejected. `dry_run` defaults to `false`. Tool remains explicit-invoke only.
