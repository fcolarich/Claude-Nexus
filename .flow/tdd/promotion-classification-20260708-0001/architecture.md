# Architecture: Promotion Classification

## Components

### PromotionTarget type (`src/core/types.ts`)
**Responsibility:** Declares the six-value union used across extraction, storage, and the MCP surface — single source of truth for valid classification values.
**Interface:**
```
export type PromotionTarget = 'none' | 'adr' | 'ddr' | 'best_practice' | 'recipe' | 'note';

// Memory interface (types.ts:44-66) gains two fields:
export interface Memory {
  // ...existing fields...
  promotion_target: PromotionTarget;  // NOT NULL, default 'none'
  promoted_to: string | null;         // artifact ref once promoted, else null
}
```

### Extraction classifier (`src/capture/extract.ts`)
**Responsibility:** Classifies each extracted candidate's `promotion_target` at LLM-extraction time and enforces conservative defaults/overrides before candidates leave the module.
**Interface:**
```
export interface MemoryCandidate {
  title: string;
  body: string;
  memory_type: MemoryType;
  scope: AtomScope;
  decay_class: DecayClass;
  confidence: number;
  tags: string[];
  promotion_target: PromotionTarget;   # NEW
}

const PROMOTION_TARGETS: Set<string>;               # validation set, mirrors MEMORY_TYPES
export function parseCandidates(raw: string): MemoryCandidate[];   # extended, unchanged signature
export function refineCandidates(cands: MemoryCandidate[]): MemoryCandidate[];  # extended, unchanged signature
```

### Schema migration (`src/core/database.ts`)
**Responsibility:** Adds `promotion_target`/`promoted_to` columns and the partial index to `memories`, idempotently, as migration 9.
**Interface:**
```
function migratePromotionClassification(db: Database.Database): void;
# Appended to MIGRATIONS[]: { version: 9, name: 'promotion-classification', up: migratePromotionClassification }
```

### Memory write path (`src/core/memories.ts`)
**Responsibility:** Persists `promotion_target` on insert; owns the one place dedup-merge decides what happens to a repeat candidate's classification.
**Interface:**
```
export interface MemoryInput {
  ...                      # existing fields unchanged
  promotion_target: PromotionTarget;   # NEW, required — caller supplies (default 'none' at call sites that don't classify)
}
export function insertMemory(db: Database.Database, input: MemoryInput): { id: string; inserted: boolean };  # SQL extended, signature unchanged
export function touchMemory(db: Database.Database, id: string): void;               # unchanged
export function upgradePromotionTarget(db: Database.Database, id: string, candidate: PromotionTarget): void;  # NEW — dedup-merge hook
```

### Reflector dedup-merge (`src/capture/reflector.ts`)
**Responsibility:** Wires the new candidate's `promotion_target` through on insert, and applies the "more specific wins" rule on both dedup paths (semantic match and exact content-id collision).
**Interface:**
```
# No new exports — reflect() body gains:
#  (a) promotion_target: c.promotion_target in the insertMemory() input object
#  (b) a call to upgradePromotionTarget() at each existing touchMemory() call site
```

### MCP review surface (`src/mcp/server.ts`)
**Responsibility:** Exposes the promotion queue read-only and closes the loop when a human formalizes a candidate.
**Interface:**
```
server.tool('nexus_promotions',
  'List memories flagged as promotion candidates (promotion_target != none, not yet promoted, not rejected/superseded), grouped by target.',
  { project: z.string().optional(), cwd: z.string().optional(), target: z.enum(['adr','ddr','best_practice','recipe','note']).optional() },
  async ({ project, cwd, target }) => { /* { content: [{ type: 'text', text }] } */ });

server.tool('nexus_mark_promoted',
  'Close the promotion loop: record the artifact ref and collapse the memory body to a thin pointer.',
  { id: z.string(), artifact_ref: z.string() },
  async ({ id, artifact_ref }) => { /* { content: [{ type: 'text', text }] } */ });
```

---

## Data Flow

### Session extraction classifies a candidate
1. `reflect()` in `reflector.ts` calls `extract()` (→ `extractMemories` in `extract.ts`, reflector.ts:87) with the condensed transcript window.
2. `extractMemories()` sends `SYSTEM_PROMPT` (now including the promotion classification block) to Haiku; the model returns JSON including `promotion_target` per item.
3. `parseCandidates()` validates each `promotion_target` against `PROMOTION_TARGETS`; missing or invalid values default to `'none'`.
4. `refineCandidates()` forces `promotion_target='none'` on any candidate whose body matches `RESTATEMENT_RE` (mirrors the existing `memory_type: 'reference'` override on the same match, extract.ts:139-145).
5. `reflect()` receives the candidate array with `promotion_target` populated.

### New memory is inserted
1. `reflect()` builds a `MemoryInput` including `promotion_target: c.promotion_target` (reflector.ts:107-119).
2. `insertMemory()` (memories.ts:63-89) runs `INSERT OR IGNORE INTO memories (..., promotion_target) VALUES (..., @promotion_target)`; `promoted_to` is never written here — it takes the column default (`NULL`).
3. On success (`inserted: true`), `reflect()` embeds the memory as today (reflector.ts:121-126) — no promotion-specific embedding behavior on first insert.
4. On content-id collision (`inserted: false` — identical `sha256(memory_type + body)` already exists, reflector.ts:127-131), `reflect()` calls `upgradePromotionTarget(db, res.id, c.promotion_target)` before `touchMemory(db, res.id)`.

### Dedup-merge (semantic match, different body)
1. `reflect()` embeds the new candidate body and calls `findSimilarMemory()` (reflector.ts:96-98).
2. On a hit above `cfg.dedup_cosine_threshold` (reflector.ts:99-104), `reflect()` calls `upgradePromotionTarget(db, sim.memory.id, c.promotion_target)`, then `touchMemory(db, sim.memory.id)` as today.
3. `upgradePromotionTarget()` writes only `UPDATE memories SET promotion_target = ? WHERE id = ? AND promotion_target = 'none'` when the candidate's target is non-`'none'` — a single scalar column write, no re-embed, no body change.

### Human reviews and promotes
1. Human/agent calls `nexus_promotions(project?, target?, cwd?)`.
2. Handler resolves project via `resolveProjectFromCwd` (server.ts:63, same as every other tool), queries `memories` filtered to open candidates, groups by `promotion_target`, formats markdown.
3. Human runs `/add-adr` (or the matching skill) in the target project — unchanged, outside this feature's scope (non-goal).
4. Human/agent calls `nexus_mark_promoted(id, artifact_ref)`.
5. Handler reads the memory row (`getMemory`, memories.ts:136); if absent, returns an error text block (mirrors `nexus_set_init`'s not-found handling, server.ts:208-211).
6. Handler computes `firstSentence = body.split(/(?<=[.!?])\s/)[0].trim()` and `newBody = ref && !firstSentence.includes(ref) ? \`${firstSentence} → ${artifact_ref}\` : firstSentence` — identical algorithm to `refineCandidates`'s restatement branch (extract.ts:141-142).
7. Handler runs `UPDATE memories SET promoted_to = ?, body = ?, content_hash = ?, updated_at = datetime('now') WHERE id = ?`. `content_hash` recomputed the same way `insertMemory` does (`sha256(body.trim())`, memories.ts:32-34) — nothing else currently keeps it in sync on a body UPDATE, so the handler must do it explicitly.
8. Handler calls `embedMemory(db, id)` (memories.ts:181-203) to regenerate the vector for the rewritten body — best-effort, matches `nexus_remember`'s `embedMemory(db, id).catch(() => {})` fire-and-forget precedent (server.ts:374).
9. Handler returns a one-line confirmation text.

---

## Storage

### `memories` table additions (migration 9)
```sql
ALTER TABLE memories ADD COLUMN promotion_target TEXT NOT NULL DEFAULT 'none'
  CHECK(promotion_target IN ('none','adr','ddr','best_practice','recipe','note'));
ALTER TABLE memories ADD COLUMN promoted_to TEXT;  -- NULL until promoted; artifact ref e.g. 'ADR-063', 'BP-shaders-012', or a file path
CREATE INDEX IF NOT EXISTS idx_memories_promotion ON memories(promotion_target) WHERE promotion_target != 'none';
```
Notes:
- SQLite allows a column-level `CHECK` on `ALTER TABLE ADD COLUMN` as long as it only references the new column and a constant default is supplied for existing rows — both conditions hold here.
- Both `ALTER`s wrapped in `try { } catch { }` for idempotency, mirroring `migrateCoworkSupport` (database.ts:400-404) and `migrateLoadAtInit` (database.ts:406-408). The index uses `CREATE INDEX IF NOT EXISTS`.
- Partial index keeps it tiny — only rows that are actual promotion candidates are indexed, matching `nexus_promotions`'s leading WHERE predicate exactly.

### `MemoryCandidate` / `MemoryInput` shape (in-process, not a table)
```
promotion_target: PromotionTarget   # 'none' | 'adr' | 'ddr' | 'best_practice' | 'recipe' | 'note'
```

---

## Decisions

### Migration is column-additive, registered as version 9 in the existing framework
**Decision:** Append `{ version: 9, name: 'promotion-classification', up: migratePromotionClassification }` to `MIGRATIONS[]` (database.ts:51-60). Body uses two guarded `try { db.exec('ALTER TABLE memories ADD COLUMN ...'); } catch {}` statements plus a guarded `CREATE INDEX IF NOT EXISTS`.
**Alternatives:** (a) PRAGMA `table_info` column-existence check before each ALTER (the design's guess at the guard mechanism); (b) full table recreate (as `migrateRemoveTaskSupport`/parts of `migrateCorpusExpansion` do for `atoms`) to get a table-level CHECK spanning both new columns together.
**Rationale:** Verified against actual migrations in `database.ts` — none use PRAGMA-based guards for simple additive columns; they all use swallowed `try/catch` around the `ALTER` itself (`migrateCoworkSupport`, `migrateLoadAtInit`, `migrateReflectionCursor` at :506, the `linked_at` adds inside `migrateCorpusExpansion` at :564/:567). Table recreate is reserved for changes that widen an *existing* CHECK constraint (e.g. `atom_type` gaining `'task'`, or `source_type` gaining `'project_doc'`) — `memory_type`'s CHECK is untouched here, so recreate is unnecessary complexity. `schema_version` handling (record-after-success, idempotent skip via `m.version <= current`, database.ts:78-86) requires no changes — just the new array entry.

### `promotion_target` flows through `insertMemory`'s existing `INSERT OR IGNORE`; no `ON CONFLICT DO UPDATE` exists to extend
**Decision:** Add `promotion_target` (required, no default) to `MemoryInput` and to the column/value lists of `insertMemory`'s `INSERT OR IGNORE INTO memories (...)` (memories.ts:63-89). Do not add an `ON CONFLICT` clause — there isn't one to add a SET-clause field to.
**Alternatives:** The design's Key Questions assumed the memory INSERT lives in `reflector.ts` and uses `ON CONFLICT DO UPDATE`, requiring `promotion_target` added to its SET clause per the repo's "SET clause must include all fields" convention.
**Rationale:** Verified directly: `reflector.ts` contains no raw INSERT SQL at all — it calls `insertMemory()` (imported from `../core/memories.js`, reflector.ts:17-18). `insertMemory` (memories.ts:65-72) is `INSERT OR IGNORE INTO memories (...) VALUES (...)` with zero `ON CONFLICT` clause. Grep for `INSERT INTO memories` only surfaces the `memories_ai` FTS trigger (database.ts:464-467) and the legacy-import migration (database.ts:521-539) — neither is the live write path and neither is an UPSERT either. The repo's "ON CONFLICT DO UPDATE must include all fields in SET" convention genuinely exists elsewhere (session upserts) but does not apply to this insert. This corrects a wrong assumption baked into the design; called out explicitly so `/plan` doesn't inherit it.

### Dedup-merge policy: "first non-'none' classification is sticky," via a dedicated `upgradePromotionTarget` helper
**Decision:** On both dedup paths in `reflector.ts` — semantic-similarity match (reflector.ts:99-104) and exact content-id collision (reflector.ts:127-131) — call `upgradePromotionTarget(db, id, candidate.promotion_target)` immediately before `touchMemory()`. It executes `UPDATE memories SET promotion_target = ? WHERE id = ? AND promotion_target = 'none'`, so it only ever moves a stored `'none'` to a specific target; it never overwrites one non-`'none'` value with a different one, and never downgrades a specific value back to `'none'`. `promoted_to` is never touched by this helper.
**Alternatives considered:**
1. *Do nothing on merge* (leave `promotion_target` exactly as first inserted, forever) — simplest, but a `'none'`-classified first observation (plausible: early sessions rarely have the full rationale a maintainer would formalize) would permanently suppress a later session's correct `'adr'`/`'ddr'` classification of the same recurring fact, even though the fact never changed — only the model's read of its promotion-worthiness improved with more context.
2. *Always overwrite with the latest candidate's value* (most-recent-wins) — risks flapping: a slightly reworded restatement in a later session could get force-classified `'none'` by `refineCandidates()`'s `RESTATEMENT_RE` path (extract.ts:139) and silently erase a valid pending promotion that a human hasn't gotten to yet.
3. *Prefer non-`'none'` over `'none'`, sticky thereafter* (selected) — once a memory has been flagged as a real candidate by any session, it stays flagged until a human resolves it via `nexus_mark_promoted`; conflicting non-`'none'` classifications across sessions do not fight each other.
**Rationale:** The spec is silent on merge behavior; the design's Key Questions explicitly asked for a grounded proposal. `touchMemory()` (memories.ts:161-169) is the only mutation on this path today, and it only ever bumps `confidence`/`last_verified_at`/`updated_at` — there is no existing field-merge precedent to extend, so this is genuinely new, narrowly-scoped behavior (a single guarded UPDATE), not a modification of `touchMemory` itself, keeping it independently testable. Alternative 3 best honors the spec's own conservatism principle ("a promotion candidate creates human review work... only flag entries a maintainer would plausibly formalize") by treating a raised flag as durable until a human acts on it, rather than letting subsequent noisy or over-conservative extractions quietly un-flag it. Note: an already-promoted memory (`promoted_to` set) has already been rewritten to a short pointer body by `nexus_mark_promoted`, so its embedding differs substantially from a fresh verbose candidate — it is unlikely to trip the dedup similarity threshold again in practice, but even if it did, `upgradePromotionTarget`'s guard (`WHERE promotion_target = 'none'`) is a no-op against a non-`'none'` stored value, so a promoted memory's classification can never be clobbered by a later dedup hit.

### `nexus_mark_promoted` re-embeds after rewriting the body
**Decision:** The handler calls `embedMemory(db, id)` (memories.ts:181-203, existing function, unchanged signature) immediately after the `UPDATE ... SET body = ...` that rewrites the memory to thin-pointer form. Best-effort — a failed embed does not fail the tool call.
**Alternatives:** Leave the vector stale until the next `nexus_consolidate`/`embedUnindexedMemories` sweep picks it up.
**Rationale:** `embedMemory()` always re-derives its embedding input from the *current* `title`+`body` row content (memories.ts:186-191) — it is the repo's sole mechanism for keeping `memories_vec` in sync with a body change. Every existing body-affecting path uses it this way: `reflect()` calls it right after a fresh `insertMemory()` insert (reflector.ts:121-123); `refineCandidates()`'s restatement rewrite happens *before* insert (extract.ts:139-145, called from `extractMemories` at :160 prior to any DB write), so the rewritten, shortened body is what gets embedded on first write — same effective behavior, just pre- vs post-insert, not a "leave it stale" precedent. Critically, `embedUnindexedMemories()` (memories.ts:206-235) only backfills rows with *no* vector at all (`rowid NOT IN (SELECT rowid FROM memories_vec)`) — a stale-but-present vector for a promoted memory would never be corrected by any existing sweep. Skipping the re-embed would leave every promoted memory permanently mis-embedded against its old, longer body, actively degrading `nexus_search`/`nexus_crossref` semantic matching for exactly the memories a human just curated. Fire-and-forget precedent: `nexus_remember`'s `embedMemory(db, id).catch(() => {})` (server.ts:374).

### `nexus_mark_promoted` recomputes `content_hash` on the body rewrite
**Decision:** The UPDATE also sets `content_hash = sha256(newBody.trim())`, matching `contentHash()` (memories.ts:32-34), the same helper `insertMemory` uses.
**Alternatives:** Leave `content_hash` as originally computed against the pre-promotion body.
**Rationale:** `content_hash` exists to detect content drift; leaving it stale after an intentional, permanent body rewrite would make the column lie about what's actually stored. `computeMemoryId` (the content-addressed primary key) is deliberately NOT recomputed — the row's `id` must stay stable across promotion so existing links (`memory_links`, `superseded_by` references) don't dangle.

### MCP tool response shape mirrors existing markdown-text tools, not JSON
**Decision:** `nexus_promotions` and `nexus_mark_promoted` return `{ content: [{ type: 'text', text: <markdown string> }] }`. `nexus_promotions` mirrors the read-only grouped-list shape of `nexus_sessions` (server.ts:257-281) and `nexus_health` (server.ts:285-308) — header line + grouped markdown sections, empty-case text `'No promotion candidates found.'`. `nexus_mark_promoted` mirrors the mutation-confirmation shape of `nexus_set_init` (server.ts:200-227) / `nexus_verify` (server.ts:472-482) — one-line confirmation text, or an error text block when `id` is not found.
**Alternatives:** Structured JSON content (`text: JSON.stringify(rows)`), since `nexus_promotions` is a "review surface" another agent might parse.
**Rationale:** Every one of the 15 existing tools in `server.ts` returns exactly one markdown text content block — none return JSON. Consistency with the established contract outweighs marginal machine-parseability gains; a human or another agent reading `nexus_promotions` output benefits from the same grouped-markdown rendering the rest of the tool surface already uses.

### `nexus_promotions` query and grouping
**Decision:** `SELECT id, title, body, confidence, source_session_id, promotion_target FROM memories WHERE promotion_target != 'none' AND promoted_to IS NULL AND review_status != 'rejected' AND superseded_by IS NULL` plus optional `AND project = ?` and `AND promotion_target = ?` (from the `target` param), ordered `promotion_target, confidence DESC`. Grouping into `## <target>` markdown sections happens in the handler, not via SQL `GROUP BY`.
**Alternatives:** Extend `listMemories` (memories.ts:141-155) with promotion-specific filters; SQL-level `GROUP BY` with aggregate counts only.
**Rationale:** WHERE predicates lifted verbatim from spec §3 / design piece 3. A dedicated query is cleaner than overloading `listMemories`'s generic filter surface for one caller with a distinct predicate shape (four ANDed conditions, none of which map to `listMemories`'s existing optional filters). Grouping in JS mirrors how `nexus_health` groups diagnostics via `Object.entries(stats.diagnosticsByType)` (server.ts:300) — each candidate needs its full row rendered, not just a count, so client-side grouping over an ordered result set is simpler than SQL aggregation.

---

## Test Strategy

### `src/capture/extract.test.ts` (existing file, new cases)
- `parseCandidates`: each of the six valid `promotion_target` values round-trips.
- `parseCandidates`: missing field → defaults `'none'` (backward-compat — old extraction JSON without the field).
- `parseCandidates`: invalid/garbage value → defaults `'none'`.
- `refineCandidates`: a `decision` body matching `RESTATEMENT_RE` → emitted reference has `promotion_target='none'` even when the input candidate carried e.g. `'adr'`.
- `refineCandidates`: a non-restatement candidate's `promotion_target` passes through unchanged.

### `src/core/database.test.ts` (existing file, new cases — reuse `schemaVersion`/`tableExists`/`columnExists` helpers already defined at the top of the file)
- Fresh `:memory:` DB via `openDatabase(':memory:')` + `initializeSchema`: `columnExists(db, 'memories', 'promotion_target')` and `columnExists(db, 'memories', 'promoted_to')` both true; `schemaVersion(db)` equals `LATEST_SCHEMA_VERSION` (now 9).
- CHECK constraint: inserting a memory row with an invalid `promotion_target` value throws (mirrors the existing `source_type='invalid_type' throws` test at database.test.ts:66-76).
- Idempotency: `initializeSchema` called twice on the same DB — `schema_version` row count unchanged, no throw (mirrors the existing idempotency test at database.test.ts:78-88).
- Partial index exists: query `sqlite_master` for `idx_memories_promotion`.

### `src/core/memories.test.ts` (existing file, new cases — reuse `freshDb()` helper)
- `insertMemory` with `promotion_target: 'adr'` → `getMemory()` returns `promotion_target='adr'`, `promoted_to=null`.
- `upgradePromotionTarget`: stored `'none'` + candidate `'ddr'` → row becomes `'ddr'`.
- `upgradePromotionTarget`: stored `'ddr'` + candidate `'adr'` → row stays `'ddr'` (first-non-none is sticky).
- `upgradePromotionTarget`: stored `'ddr'` + candidate `'none'` → row stays `'ddr'` (never downgrades).

### `src/capture/reflector.test.ts` (existing file, new cases — reuse `freshDb()`/transcript helpers)
- A candidate with `promotion_target` set flows through to the inserted row.
- Dedup-merge (semantic-match branch): first session inserts a `'none'`-classified candidate; a second, similar-enough candidate classified `'ddr'` triggers the merge path — assert the stored memory's `promotion_target` becomes `'ddr'`.
- Dedup-merge (content-id collision branch): identical `memory_type`+`body` candidate re-submitted with a different `promotion_target` — assert sticky-first behavior.

### MCP tool tests (new — colocate as `src/mcp/server.test.ts` if no test currently covers `server.ts`; otherwise extend the nearest existing test that exercises tool-level logic against a `:memory:` DB, consistent with how `memories.test.ts` already tests `rememberBatch` as a stand-in for the `nexus_remember_batch` tool's logic)
- `nexus_promotions`: returns only rows satisfying all four WHERE predicates; a row with `promoted_to` set, `review_status='rejected'`, `superseded_by` set, or `promotion_target='none'` is excluded from each respective case.
- `nexus_promotions`: `target` filter narrows to one group; no matches → `'No promotion candidates found.'` text.
- `nexus_mark_promoted`: sets `promoted_to`; body ends with `→ <artifact_ref>`; title unchanged; `review_status` unchanged; `content_hash` updated to match the new body.
- `nexus_mark_promoted`: unknown `id` → error text, no write performed.
- `nexus_mark_promoted`: re-embed is invoked after the rewrite (assert via an injected embed fake, or by checking `memories_vec` row content changes); tool still returns success text when embedding is unavailable (embed fn returns false).

### Backward compatibility
- Existing extraction JSON fixtures (no `promotion_target` field) still parse via `parseCandidates` with `promotion_target='none'` defaulted — covered by the "missing field" case above; no existing test in `extract.test.ts` should need modification, only additions.
- Full `npm test` run: all pre-existing ~107 tests continue to pass (acceptance criterion, spec §Acceptance).

### Acceptance (spec §Acceptance / design Success Criteria — manual/integration, not unit)
- A session containing an unformalized design decision yields a memory with `promotion_target='ddr'|'adr'`; listed by `nexus_promotions`.
- A session restating ADR-051 yields a reference memory with `promotion_target='none'`.
- `nexus_mark_promoted(id, 'ADR-063')` leaves a thin pointer whose body ends in `→ ADR-063`.
- Migration is idempotent: opening an already-migrated DB is a no-op.

---

## Files to Modify

| File | Change |
|---|---|
| `src/core/types.ts` | Add `PromotionTarget` type next to `MemoryType`; add `promotion_target`/`promoted_to` to `Memory` interface |
| `src/capture/extract.ts` | `MemoryCandidate.promotion_target`; `PROMOTION_TARGETS` set; `SYSTEM_PROMPT` classification block (verbatim from spec §1, inserted after the `memory_type` block); `parseCandidates()` default-`'none'` validation; `refineCandidates()` force-`'none'` on `RESTATEMENT_RE` match |
| `src/capture/extract.test.ts` | New cases: classification parse (all six values), default-none on missing/invalid, restatement forces `'none'`, non-restatement passes through |
| `src/core/database.ts` | New migration 9 `migratePromotionClassification`; append to `MIGRATIONS[]` |
| `src/core/database.test.ts` | New cases: columns exist, CHECK rejects invalid value, index exists, idempotent re-init |
| `src/core/memories.ts` | `MemoryInput.promotion_target` (required); `insertMemory()` SQL extended; new `upgradePromotionTarget()` export |
| `src/core/memories.test.ts` | New cases: insert round-trip persists `promotion_target`; `upgradePromotionTarget()` upgrades none→specific, sticky on specific→specific, never downgrades |
| `src/capture/reflector.ts` | Pass `promotion_target` into `insertMemory()`'s `MemoryInput`; call `upgradePromotionTarget()` on both dedup-merge branches (semantic match + content-id collision) before `touchMemory()` |
| `src/capture/reflector.test.ts` | New cases: promotion_target flows through on fresh insert; dedup-merge upgrades none→specific (semantic path); dedup-merge sticky on collision path |
| `src/mcp/server.ts` | New tools `nexus_promotions(project?, target?, cwd?)` and `nexus_mark_promoted(id, artifact_ref)` |
| `src/mcp/server.test.ts` (new, or nearest equivalent) | Cases for both new tools per Test Strategy above |

No new files beyond a possible new MCP test file (confirm exact placement/naming in `/plan` — the repo currently has no dedicated `server.test.ts`; tool-adjacent logic is otherwise tested via the underlying `core`/`capture` functions directly).

## Dashboard filter chip (lowest priority, not architected)

Spec §3 and design piece 4 mark this optional and lowest priority — skip if effort balloons. If pursued, it is a `src/frontend` filter chip on the memories view querying the same `promotion_target != 'none' AND promoted_to IS NULL` predicate `nexus_promotions` already exposes, likely via a new or extended read endpoint in `src/web/server.ts`. Not scoped further here; defer entirely to `/plan` if it's kept in scope at all.

---

## Checkpoint

**Files to modify:** `src/core/types.ts`, `src/capture/extract.ts` (+ `extract.test.ts`), `src/core/database.ts` (+ `database.test.ts`), `src/core/memories.ts` (+ `memories.test.ts`), `src/capture/reflector.ts` (+ `reflector.test.ts`), `src/mcp/server.ts`.

**New files:** `src/mcp/server.test.ts` (or nearest equivalent placement, TBD in `/plan` — no existing precedent test file for `server.ts` tool logic).

**Key decisions:**
- INSERT path is `insertMemory()` in `src/core/memories.ts` using `INSERT OR IGNORE` — **not** `ON CONFLICT DO UPDATE` as the design assumed. `reflector.ts` has no raw INSERT SQL at all; it calls `insertMemory()`. No SET clause exists to extend.
- Migration registered as version 9 in the existing `MIGRATIONS[]` array, using the repo's real guard pattern (swallowed `try/catch` around each `ALTER TABLE ADD COLUMN`, not a PRAGMA `table_info` check as the design guessed).
- Dedup-merge policy: "first non-`'none'` classification is sticky" — a new `upgradePromotionTarget()` helper upgrades a stored `'none'` to the candidate's specific value but never overwrites one specific value with another, and never downgrades. Grounded in `touchMemory()` having zero prior field-merge behavior — this is new, narrowly-scoped logic, not an extension of existing merge code.
- `nexus_mark_promoted` re-embeds the rewritten body via the existing `embedMemory()` (best-effort) and recomputes `content_hash` — leaving either stale would drift search/dedup and the drift-detection column against the actually-stored promoted body.
- Both new MCP tools return `{ content: [{ type: 'text', text }] }` markdown, matching all 15 existing tools — no JSON responses anywhere in `server.ts`.

**Open questions (non-blocking, flagged for `/plan`):**
- Exact placement/filename for MCP tool-logic tests (no existing `server.test.ts` precedent).
- Whether `nexus_promotions`'s `target` param should validate strictly or pass through unchecked (no existing tool in `server.ts` validates enum-like params beyond the Zod schema itself).
- Dashboard filter chip: keep or drop — explicitly optional/lowest-priority per spec and design.
