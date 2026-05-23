# Implementation Spec — Claude Nexus Corpus Expansion (Features 1–4)

## Overview

Incremental hybrid linking with in-memory BM25 and sqlite-vec dense search, merged via RRF. Implements:
- F1: `sessions.cwd` persistence
- F2: Project `.md` scanning via `discoverProjectDocs`
- F3: Auto-linking via `src/core/links.ts` (hybrid BM25 + dense + RRF)
- F4: `nexus_crossref` MCP tool

## Current State (as of May 2026)

### Key observations from source audit:

**`src/core/types.ts`:**
- `SourceType` union: `'memory_file' | 'agent_def' | 'skill_def' | 'plan_file' | 'nexus_native'` — missing `'project_doc'`
- `Atom` interface: no `linked_at` field
- `Memory` interface: no `linked_at` field
- `Session` interface: no `cwd` field

**`src/core/database.ts`:**
- Latest migration: 5 (`session-messages-fts`)
- `LATEST_SCHEMA_VERSION = 5`
- `atoms` table `source_type CHECK`: does not include `'project_doc'`
- `sessions` table: no `cwd` column
- `atoms` table: no `linked_at` column
- `memories` table: no `linked_at` column
- Migration pattern confirmed: `migrateTaskSupport` does full table recreate with `foreign_keys = OFF`

**`src/indexer/scanner.ts`:**
- `SourceFile` interface: `{ path: string; sourceType: SourceType }`
- No `discoverProjectDocs` function
- Uses `globSync` from `glob` package (already a dep)

**`src/indexer/indexer.ts`:**
- `embedUnindexed`: loops over unembedded atoms, calls `generateEmbedding`, inserts into `atoms_vec` — no `linkAtom` call
- `runFullIndex`: calls `discoverSources()` + indexes, then sessions, then `embedUnindexed()` — no `discoverProjectDocs` call
- `upsertSession` prepared statement: does NOT include `cwd` in `DO UPDATE SET` — safe, indexer won't overwrite reflector's cwd

**`src/capture/reflector.ts`:**
- `ReflectOptions` already has `cwd?: string`
- `INSERT OR IGNORE INTO sessions` does not write `cwd`
- No `linkMemory` call after `embedMemory`

**`src/mcp/server.ts`:**
- Has `resolveProjectFromCwd` utility already
- No `nexus_crossref` tool

**`package.json`:**
- No `wink-bm25-text-search` dependency
- No `@types/wink-bm25-text-search` in devDependencies

---

## Implementation Tasks (ordered by dependency)

### T-001: Add `wink-bm25-text-search` dependency

**File:** `package.json`

Add `"wink-bm25-text-search": "^2.3.0"` to `dependencies`. Check if `@types/wink-bm25-text-search` exists on npm; if not, create `src/types/wink-bm25-text-search.d.ts` type shim.

The shim (if needed):
```typescript
declare module 'wink-bm25-text-search' {
  interface BM25Index {
    defineConfig(cfg: object): void;
    definePipeline(fns: Function[]): void;
    defineFields(fields: string[]): void;
    addDoc(doc: object, uid: string): void;
    consolidate(): void;
    search(query: string, limit: number): { ref: string; score: number }[];
  }
  function BM25(): BM25Index;
  export = BM25;
}
```

**Acceptance criteria:**
- `npm install` succeeds with `wink-bm25-text-search` in `node_modules`
- `import BM25 from 'wink-bm25-text-search'` compiles without TypeScript errors
- No native add-on compilation required

---

### T-002: Extend `src/core/types.ts`

**File:** `src/core/types.ts`

Changes:
1. Add `'project_doc'` to `SourceType` union
2. Add `linked_at: string | null` to `Atom` interface (after `updated_at`)
3. Add `linked_at: string | null` to `Memory` interface (after `updated_at`)
4. Add `CrossRefResult` interface
5. Add `cwd?: string | null` to `Session` interface

```typescript
// SourceType
export type SourceType = 'memory_file' | 'agent_def' | 'skill_def' | 'plan_file' | 'nexus_native' | 'project_doc';

// Atom interface — add after updated_at:
linked_at: string | null;

// Memory interface — add after updated_at:
linked_at: string | null;

// Session interface — add after last_reflected_index:
cwd: string | null;

// New interface:
export interface CrossRefResult {
  id: string;
  title: string;
  atom_type: string;
  link_type: LinkType | null;
  score: number;
  body_snippet: string;
}
```

**Acceptance criteria:**
- TypeScript compiles with no errors after change
- `SourceType` includes `'project_doc'`
- `Atom.linked_at` and `Memory.linked_at` present with type `string | null`
- `CrossRefResult` interface exported

---

### T-003: Add Migration 6 to `src/core/database.ts`

**File:** `src/core/database.ts`

Add `migrateCorpusExpansion(db)` function and register it as version 6 in `MIGRATIONS`. Update `LATEST_SCHEMA_VERSION` to 6.

Migration applies:
1. `ALTER TABLE memories ADD COLUMN linked_at TEXT` (guarded try/catch)
2. `ALTER TABLE sessions ADD COLUMN cwd TEXT` (guarded try/catch)
3. Full recreate of `atoms` table to extend `source_type CHECK` to include `'project_doc'` and add `linked_at TEXT` column — uses same `foreign_keys = OFF` + transaction pattern as `migrateTaskSupport`

Guard for atoms recreate: check `sqlite_master` for `'project_doc'` in atoms `sql`. Also handle edge case where `project_doc` was added but `linked_at` is missing.

Add `idx_atoms_linked` index on `atoms(linked_at)` after recreate.

**Acceptance criteria:**
- `initializeSchema(openDatabase(':memory:'))` runs without error
- `SELECT sql FROM sqlite_master WHERE type='table' AND name='atoms'` contains `'project_doc'`
- `PRAGMA table_info(sessions)` lists `cwd` column
- `PRAGMA table_info(atoms)` lists `linked_at` column
- `PRAGMA table_info(memories)` lists `linked_at` column
- `LATEST_SCHEMA_VERSION === 6`
- Migration is idempotent: calling `initializeSchema` twice does not throw

---

### T-004: Create `src/core/links.ts`

**File:** `src/core/links.ts` (new)

New file implementing the hybrid BM25 + dense linking core. Full API:

```typescript
export type Bm25Index = ReturnType<typeof BM25>;
export interface RankedResult { id: string; score: number; }

export function buildBm25Corpus(atoms: { id: string; title: string; body: string }[]): Bm25Index
export function rrfMerge(bm25Results: RankedResult[], denseResults: RankedResult[], topK?: number, K?: number): RankedResult[]
export function upsertLink(db: Database.Database, sourceId: string, targetId: string, linkType: LinkType, confidence: number, table: 'atom_links' | 'memory_links'): void
export async function linkAtom(db: Database.Database, atomId: string, embedFn: (text: string) => Promise<Float32Array | null>, corpus?: Bm25Index): Promise<void>
export async function linkMemory(db: Database.Database, memoryId: string, embedFn: (text: string) => Promise<Float32Array | null>, corpus?: Bm25Index): Promise<void>
```

Key implementation details:

**`buildBm25Corpus`:** Creates wink-bm25 index. Fields: `['text']`. Documents: `{ text: atom.title + '\n' + atom.body }`, uid = atom.id. Calls `consolidate()` before returning.

**`rrfMerge`:** Standard RRF formula `score += 1/(K + rank)` where rank is 1-indexed. Returns top `topK` items sorted descending by merged score.

**`upsertLink`:** Skip self-links (`sourceId === targetId`). Insert both (sourceId→targetId) and (targetId→sourceId). Use `INSERT OR IGNORE` with `UNIQUE(source_id, target_id, link_type)`.

**`linkAtom`:**
1. Fetch atom row — return if not found
2. Skip guard: `if (row.linked_at && row.linked_at > row.updated_at) return`
3. Generate embedding for `title + '\n' + body`
4. Dense KNN: `SELECT rowid, distance FROM atoms_vec WHERE embedding MATCH json(?) ORDER BY distance LIMIT 24`; exclude self; convert L2 → cosine similarity: `1 - (distance² / 2)`
5. BM25: use `corpus` if provided, else build from all atoms; search for `title + ' ' + body` (top 24)
6. `rrfMerge(bm25Results, denseResults, 12)`
7. For each merged result, compute similarity from dense results (fall back to 0.5 if only BM25 hit); apply threshold: `≥0.86 → 'duplicates'`, `0.70–0.86 → 'related'`, skip below 0.70
8. Call `upsertLink` for qualifying results
9. `UPDATE atoms SET linked_at = datetime('now') WHERE id = ?`

**`linkMemory`:**
1. Fetch memory row — return if not found
2. Skip guard: `if (row.linked_at && row.linked_at > row.updated_at) return`
3. Generate embedding for `title + '\n' + body`
4. Dense KNN over `memories_vec` (top 24, exclude self)
5. BM25 over atom corpus (top 24)
6. `rrfMerge` → top 12
7. Apply similarity threshold → upsertLink in `'memory_links'`
8. `UPDATE memories SET linked_at = datetime('now') WHERE id = ?`

Note on similarity for RRF results: use the dense similarity score for the threshold decision. If a result only appears in BM25 (no dense score), skip the similarity threshold check and use link type `'related'` with confidence 0.7.

**Acceptance criteria:**
- `rrfMerge`: item in both lists ranks above item in only one list
- `rrfMerge`: empty dense list → BM25 results still returned
- `upsertLink`: two rows inserted for A→B call; second identical call → same row count
- `upsertLink`: A→A call → zero rows inserted
- `linkAtom`: atom with `linked_at > updated_at` → no `atom_links` rows written, `linked_at` unchanged
- `linkAtom`: self-link never written even when corpus contains the same atom
- `buildBm25Corpus`: exact-title match scores above unrelated doc

---

### T-005: Add `discoverProjectDocs` to `src/indexer/scanner.ts`

**File:** `src/indexer/scanner.ts`

Add `discoverProjectDocs(db: Database.Database): SourceFile[]` function.

Also extend `SourceFile` interface:
```typescript
export interface SourceFile {
  path: string;
  sourceType: SourceType;
  atomTypeOverride?: AtomType;  // for project_doc type derivation
}
```

Implementation:
1. `SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL` → array of cwd strings
2. For each cwd: `existsSync(cwd)` — skip if missing
3. `globSync('**/*.md', { cwd, ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'], absolute: true })`
4. Derive `atomTypeOverride` from filename:
   - Frontmatter `type:` if valid AtomType (use gray-matter)
   - `/^CLAUDE\.md$/i` → `'reference'`
   - `/^README\.md$/i` → `'reference'`
   - `/architecture/i` in filename → `'architecture'`
   - `/\.plan\.md$|^plan/i` in filename → `'plan'`
   - default → `'project_note'`
5. Return `{ path, sourceType: 'project_doc', atomTypeOverride }`

Import needed: `import Database from 'better-sqlite3'`

**Acceptance criteria:**
- Returns `SourceFile[]` for all `.md` files under each cwd in sessions
- Ignores `node_modules/`, `dist/`, `build/`, `.git/` paths
- Deduplication: two sessions with same cwd → each md file appears once (via `DISTINCT`)
- Missing/nonexistent cwd → skipped silently
- `cwd IS NULL` sessions excluded from query
- `atomTypeOverride` is `'reference'` for `CLAUDE.md`, `'architecture'` for `architecture.md`, `'project_note'` for generic `.md`

---

### T-006: Update `src/indexer/indexer.ts`

**File:** `src/indexer/indexer.ts`

Two changes:

**Change 1 — `runFullIndex`:** After `indexAll()` call, add project doc indexing:
```typescript
const projectDocs = discoverProjectDocs(db);
const indexProjectDocs = db.transaction(() => {
  for (const source of projectDocs) {
    const result = indexFile(db, stmts, source.path, source.sourceType);
    stats.atomsCreated += result.created;
    stats.atomsUpdated += result.updated;
    stats.atomsUnchanged += result.unchanged;
    stats.linksCreated += result.links;
    stats.diagnosticsCreated += result.diagnostics;
  }
});
indexProjectDocs();
```
Place after `indexAll()`, before `postProcess()`.

**Change 2 — `embedUnindexed`:** Build BM25 corpus once before the loop, then call `linkAtom` after each successful embed:
```typescript
import { linkAtom, buildBm25Corpus } from '../core/links.js';

// Before loop:
const allAtomsForBm25 = db.prepare(`SELECT id, title, body FROM atoms`).all() as
  { id: string; title: string; body: string }[];
const corpus = buildBm25Corpus(allAtomsForBm25);

// Inside loop, after successful atoms_vec insert:
await linkAtom(db, atom.id, generateEmbedding, corpus);
```

Also update import from scanner: `import { discoverSources, discoverSessions, discoverCoworkSessions, discoverProjectDocs } from './scanner.js'`

**Acceptance criteria:**
- `runFullIndex` calls `discoverProjectDocs(db)` and feeds results to `indexFile`
- Project doc atoms appear in `atoms` table with `source_type = 'project_doc'`
- `embedUnindexed` builds corpus once (not per-atom)
- After embed, `linkAtom` is called with pre-built corpus
- Existing embedding behavior unchanged for non-project-doc atoms

---

### T-007: Update `src/capture/reflector.ts`

**File:** `src/capture/reflector.ts`

Two changes:

**Change 1 — persist `cwd`:** After the `INSERT OR IGNORE INTO sessions` statement, add:
```typescript
if (opts.cwd) {
  db.prepare(`UPDATE sessions SET cwd = ? WHERE session_id = ?`).run(opts.cwd, opts.session_id);
}
```

**Change 2 — call `linkMemory`:** In the `if (res.inserted)` block, after `await embedMemory(db, res.id, embed)`:
```typescript
if (res.inserted) {
  inserted++;
  const embedded = await embedMemory(db, res.id, embed);
  if (embedded) {
    await linkMemory(db, res.id, embed);
  }
}
```

Add import: `import { linkMemory } from '../core/links.js';`

Note: `embedMemory` currently returns `void`. Check `src/core/memories.ts` — if it doesn't return boolean, track success via try/catch or change approach. If `embedMemory` is void, just call `linkMemory` unconditionally after it (it has its own skip guard).

**Acceptance criteria:**
- `reflect(db, { session_id, transcript_path, project, cwd: '/some/path' }, {})` writes `cwd` to sessions row
- `reflect(db, { ..., cwd: undefined }, {})` does not error, cwd remains null
- `linkMemory` called for each newly inserted + embedded memory
- `linkMemory` not called if memory was merged (existing)

---

### T-008: Add `nexus_crossref` to `src/mcp/server.ts`

**File:** `src/mcp/server.ts`

Add `nexus_crossref` tool after `nexus_recall`. Tool signature and implementation per architecture spec.

Add imports at top:
```typescript
import { buildBm25Corpus, rrfMerge, type RankedResult } from '../core/links.js';
import { generateEmbedding } from '../core/embeddings.js';
import type { CrossRefResult, LinkType } from '../core/types.js';
```

Tool parameters:
- `query: z.string()` — required
- `project: z.string().optional()`
- `cwd: z.string().optional()`
- `limit: z.coerce.number().optional()` (default 10)

Implementation steps:
1. Dense KNN over `atoms_vec` (TOP_K = `cap * 2`)
2. BM25 search over in-memory corpus (TOP_K = `cap * 2`)
3. `rrfMerge(bm25Results, denseResults, cap)`
4. Normalize scores: `score / merged[0].score`
5. Fetch atom details for merged ids
6. JOIN `atom_links` to get link_type for each result (null if no row)
7. Return formatted markdown text

Output format per result:
```
### {title} [{link_type}]   ← omit badge if link_type null
_{atom_type} | score: {score.toFixed(2)}_

{body_snippet (first 300 chars)}
```

**Acceptance criteria:**
- `nexus_crossref` tool registered and callable via MCP
- Returns results ranked by RRF score
- `link_type` field present (null for unlinked hits, string for linked)
- Empty result set returns "No cross-references found." text
- `project` / `cwd` filter narrows results when provided

---

### T-009: Create `src/core/links.test.ts`

**File:** `src/core/links.test.ts` (new)

Unit tests for `links.ts` using vitest + in-memory sqlite.

Test setup: `openDatabase(':memory:')` + `initializeSchema(db)`.

Tests:
1. **rrfMerge — dual list ranks higher:** item in both BM25 and dense lists scores above item in only one
2. **rrfMerge — empty dense list:** BM25-only results still returned in order
3. **rrfMerge — empty BM25 list:** dense-only results returned
4. **rrfMerge — topK cap:** returns no more than `topK` items
5. **upsertLink — bidirectional insert:** call `upsertLink(db, 'a', 'b', 'related', 0.8, 'atom_links')` → verify two rows (a→b and b→a)
6. **upsertLink — idempotent:** second identical call → same row count (not doubled)
7. **upsertLink — self-link prevention:** `upsertLink(db, 'a', 'a', ...)` → zero rows inserted
8. **linkAtom — skip guard:** atom with `linked_at > updated_at` → `atom_links` stays empty
9. **linkAtom — writes links when similar atom exists:** two atoms with similar content → `atom_links` populated after `linkAtom`
10. **buildBm25Corpus — relevance ordering:** exact title match scores above unrelated doc

Fake embedFn: returns deterministic `Float32Array` based on text hash (same text → same vector, different text → orthogonal vector).

**Acceptance criteria:**
- All 10 tests pass with `vitest run`
- No real embedding server calls (fake embedFn injected)
- Tests use in-memory DB (no filesystem side effects)

---

### T-010: Create/extend `src/indexer/scanner.test.ts`

**File:** `src/indexer/scanner.test.ts` (new or extend)

Unit tests for `discoverProjectDocs` using temp dirs.

Test setup: `mkdtempSync` for temp dirs; in-memory DB with seeded session rows.

Tests:
1. **Basic discovery:** two .md files in cwd → both returned as `SourceFile[]` with `sourceType = 'project_doc'`
2. **Ignore node_modules:** `.md` file inside `node_modules/` subdir → not returned
3. **Ignore dist, build, .git:** one file in each ignored dir → none returned
4. **Dedup:** two sessions with same cwd → each md file appears exactly once
5. **Nonexistent cwd:** session row with cwd pointing to nonexistent dir → empty result, no throw
6. **NULL cwd:** session row with `cwd IS NULL` → not included in results
7. **atomTypeOverride CLAUDE.md:** file named `CLAUDE.md` → `atomTypeOverride === 'reference'`
8. **atomTypeOverride architecture.md:** file named `architecture.md` → `atomTypeOverride === 'architecture'`
9. **atomTypeOverride default:** file named `notes.md` → `atomTypeOverride === 'project_note'`

**Acceptance criteria:**
- All 9 tests pass
- Temp dirs cleaned up after each test (`afterEach` rmSync)
- No real filesystem modification beyond temp dir

---

### T-011: Extend `src/integration.test.ts` and `src/core/database.test.ts`

**Files:** `src/integration.test.ts`, `src/core/database.test.ts`

**`database.test.ts` additions (migration 6):**
1. Fresh DB → `PRAGMA table_info(sessions)` includes `cwd`
2. Fresh DB → `PRAGMA table_info(atoms)` includes `linked_at`
3. Fresh DB → `PRAGMA table_info(memories)` includes `linked_at`
4. Atom insert with `source_type='project_doc'` → no CHECK violation
5. Atom insert with `source_type='invalid_type'` → throws CHECK violation error

**`integration.test.ts` additions (project_doc corpus expansion):**
```
describe('project_doc corpus expansion', () => {
  it('indexes project .md, embeds, links, writes atom_links', async () => {
    // 1. Create temp dir with two .md files
    // 2. Seed sessions table: INSERT INTO sessions (..., cwd = tempDir)
    // 3. discoverProjectDocs(db) → verify 2 SourceFiles
    // 4. indexFile each → verify atoms with source_type='project_doc'
    // 5. embedUnindexed with fake embedFn (vecFromText pattern)
    // 6. Verify atom_links has rows with source_id or target_id matching our atoms
    // 7. Verify atoms.linked_at is set (not null)
  })
})
```

Use existing `freshDb()` and `vecFromText()` helpers if present.

**Acceptance criteria:**
- All 5 database migration tests pass
- Integration test for project_doc → embed → link passes
- `atom_links` contains at least one row per test atom after embed+link
- `atoms.linked_at` is non-null after `embedUnindexed`

---

## Checkpoint

| File | Action | Task |
|------|--------|------|
| `package.json` | Add `wink-bm25-text-search` dep + type shim | T-001 |
| `src/core/types.ts` | Add `'project_doc'`, `linked_at`, `CrossRefResult`, `cwd` | T-002 |
| `src/core/database.ts` | Add migration 6, update `MIGRATIONS` and `LATEST_SCHEMA_VERSION` | T-003 |
| `src/core/links.ts` | New file — hybrid linking core | T-004 |
| `src/indexer/scanner.ts` | Add `discoverProjectDocs`, extend `SourceFile` | T-005 |
| `src/indexer/indexer.ts` | Call `discoverProjectDocs` + `linkAtom` + `buildBm25Corpus` | T-006 |
| `src/capture/reflector.ts` | Persist `cwd`, call `linkMemory` | T-007 |
| `src/mcp/server.ts` | Add `nexus_crossref` tool | T-008 |
| `src/core/links.test.ts` | New — unit tests for links.ts | T-009 |
| `src/indexer/scanner.test.ts` | New — discoverProjectDocs unit tests | T-010 |
| `src/integration.test.ts` + `src/core/database.test.ts` | Extend with migration 6 + project_doc flow | T-011 |

---

## Risk Register

| Risk | Mitigation |
|------|------------|
| `embedMemory` returns `void` — can't gate `linkMemory` on success | Call `linkMemory` unconditionally after `embedMemory`; `linkMemory` has its own skip guard via `linked_at` |
| `atoms_vec` may be absent (sqlite-vec not loaded) | `linkAtom` catches and swallows errors from KNN query, falls back to BM25-only |
| wink-bm25-text-search API surface differs from assumed | Install and verify actual API before writing `links.ts`; shim covers only needed methods |
| Migration 6 recreate fails on large existing DB | Transaction + `foreign_keys = OFF` pattern; guard prevents re-run |
| `indexFile` doesn't handle `atomTypeOverride` in `SourceFile` | `parseFile` ignores override — need to patch `indexFile` or pass override through `parseFile` |
| `discoverProjectDocs` scans very large project dirs slowly | globSync with ignore patterns; acceptable at current scale |

---

## Implementation Order

```
T-001  →  T-002  →  T-003  (foundational — no deps)
T-004  depends on T-002 + T-003
T-005  depends on T-002 + T-003
T-006  depends on T-004 + T-005
T-007  depends on T-004
T-008  depends on T-004
T-009  depends on T-004
T-010  depends on T-005
T-011  depends on T-003 + T-004 + T-005 + T-006
```

Parallel execution possible: T-001, T-002, T-003 in parallel. Then T-004 and T-005 in parallel. Then T-006, T-007, T-008, T-009, T-010 in parallel. Then T-011.
