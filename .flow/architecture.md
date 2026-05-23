# Architecture — Claude Nexus Corpus Expansion (Features 1–4)

## Open Questions — Resolved

### Q1: CHECK constraint on `source_type` — migration strategy

**Decision: Full table recreate (same pattern as `migrateTaskSupport`).**

SQLite does not support `ALTER TABLE ... DROP CONSTRAINT` or inline constraint modification. The only safe approach is:
1. Create `atoms_new` with the updated CHECK constraint
2. `INSERT INTO atoms_new SELECT ...` (all existing columns)
3. Drop FTS triggers, drop `atoms_fts`, drop `atoms`
4. Rename `atoms_new` → `atoms`
5. Recreate FTS table + triggers + indexes

The recreate must include ALL columns present after migration 5: `id`, `title`, `body`, `atom_type`, `scope`, `source_path`, `source_type`, `project`, `tags`, `content_hash`, `frontmatter`, `created_at`, `updated_at`, `status`, `priority`, `blocks`, `blocked_by`, `discovered_from`, `load_at_init`, PLUS new `linked_at TEXT`.

The guard: check `sqlite_master` for `'project_doc'` in the atoms `sql` — skip if already present (idempotent).

Migration 6 runs inside `db.pragma('foreign_keys = OFF') / ON` and wrapped in a transaction, matching `migrateTaskSupport` exactly.

### Q2: `linked_at` on `memories` — decision

**Yes, add `linked_at TEXT` to `memories` as well.**

Rationale: `linkMemory` is symmetric to `linkAtom`. Without `linked_at` on `memories`, `linkMemory` has no skip guard and would re-run on every indexer pass. The skip logic `linked_at > updated_at` requires the column. Migration 6 adds it via guarded `ALTER TABLE memories ADD COLUMN linked_at TEXT` (no CHECK constraint to work around, so ALTER is safe).

### Q3: BM25 corpus scope and API design

**Decision: Accept optional pre-built corpus parameter.**

At current corpus sizes (< 50k atoms) the O(N) rebuild per link call is acceptable. However, `embedUnindexed()` calls `linkAtom()` per atom in a loop — N atoms × O(N) corpus build = O(N²). To avoid future refactor, the `links.ts` API accepts an optional pre-built `Bm25Index` parameter:

```typescript
linkAtom(db, atomId, embedFn, corpus?: Bm25Index): Promise<void>
linkMemory(db, memoryId, embedFn, corpus?: Bm25Index): Promise<void>
```

`embedUnindexed()` builds the corpus once before the loop and passes it to each `linkAtom` call. `nexus_crossref` builds its own corpus per call (single-shot, no loop).

### Q4: `nexus_crossref` output for unlinked results

**Decision: `link_type: null` (field present, value null).**

Omitting the field makes consumer code fragile (needs `'link_type' in result` checks). Returning `null` is a clear signal: "this result was retrieved by the search but has no existing link row." Consumers can filter on `link_type !== null` to get only pre-linked results, or use all results for display.

---

## Migration 6 — Full Specification

**Version:** 6  
**Name:** `corpus-expansion-cwd-links`

### SQL statements (in order)

```sql
-- Step 1: Add linked_at to memories (guarded ALTER — safe, no CHECK to update)
ALTER TABLE memories ADD COLUMN linked_at TEXT;

-- Step 2: Add cwd to sessions (guarded ALTER — safe, no CHECK to update)
ALTER TABLE sessions ADD COLUMN cwd TEXT;

-- Step 3: Recreate atoms table to extend source_type CHECK + add linked_at
-- (executed inside foreign_keys=OFF transaction, guarded by schema sql check)
CREATE TABLE atoms_new (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  atom_type     TEXT NOT NULL CHECK(atom_type IN (
    'memory', 'agent', 'skill', 'plan', 'feedback', 'reference',
    'project_note', 'architecture', 'task'
  )),
  scope         TEXT NOT NULL DEFAULT 'project' CHECK(scope IN ('global', 'shared', 'project')),
  source_path   TEXT NOT NULL,
  source_type   TEXT NOT NULL CHECK(source_type IN (
    'memory_file', 'agent_def', 'skill_def', 'plan_file', 'nexus_native', 'project_doc'
  )),
  project       TEXT,
  tags          TEXT NOT NULL DEFAULT '[]',
  content_hash  TEXT NOT NULL,
  frontmatter   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  linked_at     TEXT,
  status        TEXT,
  priority      INTEGER,
  blocks        TEXT,
  blocked_by    TEXT,
  discovered_from TEXT,
  load_at_init  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO atoms_new
  (id, title, body, atom_type, scope, source_path, source_type, project, tags,
   content_hash, frontmatter, created_at, updated_at, status, priority, blocks,
   blocked_by, discovered_from, load_at_init)
SELECT id, title, body, atom_type, scope, source_path, source_type, project, tags,
       content_hash, frontmatter, created_at, updated_at, status, priority, blocks,
       blocked_by, discovered_from, load_at_init
FROM atoms;

DROP TRIGGER IF EXISTS atoms_ai;
DROP TRIGGER IF EXISTS atoms_ad;
DROP TRIGGER IF EXISTS atoms_au;
DROP TABLE IF EXISTS atoms_fts;
DROP TABLE atoms;
ALTER TABLE atoms_new RENAME TO atoms;

-- Recreate FTS virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS atoms_fts USING fts5(
  title, body, tags,
  content='atoms',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Recreate triggers
CREATE TRIGGER IF NOT EXISTS atoms_ai AFTER INSERT ON atoms BEGIN
  INSERT INTO atoms_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS atoms_ad AFTER DELETE ON atoms BEGIN
  INSERT INTO atoms_fts(atoms_fts, rowid, title, body, tags)
  VALUES ('delete', old.rowid, old.title, old.body, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS atoms_au AFTER UPDATE ON atoms BEGIN
  INSERT INTO atoms_fts(atoms_fts, rowid, title, body, tags)
  VALUES ('delete', old.rowid, old.title, old.body, old.tags);
  INSERT INTO atoms_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
END;

-- Rebuild FTS from current atoms
INSERT INTO atoms_fts(atoms_fts) VALUES('rebuild');

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_atoms_project ON atoms(project);
CREATE INDEX IF NOT EXISTS idx_atoms_type ON atoms(atom_type);
CREATE INDEX IF NOT EXISTS idx_atoms_scope ON atoms(scope);
CREATE INDEX IF NOT EXISTS idx_atoms_source ON atoms(source_path);
CREATE INDEX IF NOT EXISTS idx_atoms_hash ON atoms(content_hash);
CREATE INDEX IF NOT EXISTS idx_atoms_linked ON atoms(linked_at);
```

### Guard logic

```typescript
function migrateMigration6(db: Database.Database): void {
  // Guard: skip if already applied
  const schemaRow = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='atoms'`
  ).get() as { sql: string } | undefined;

  // ALTER statements (safe regardless — try/catch swallows if column exists)
  try { db.exec(`ALTER TABLE memories ADD COLUMN linked_at TEXT`); } catch {}
  try { db.exec(`ALTER TABLE sessions ADD COLUMN cwd TEXT`); } catch {}

  // Atoms recreate: only if project_doc not yet in CHECK
  if (schemaRow && !schemaRow.sql.includes("'project_doc'")) {
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        // ... full recreate SQL above ...
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  } else if (schemaRow && !schemaRow.sql.includes('linked_at')) {
    // Edge case: project_doc was added by a previous partial migration but linked_at missing
    try { db.exec(`ALTER TABLE atoms ADD COLUMN linked_at TEXT`); } catch {}
  }
}
```

---

## Type Changes — `src/core/types.ts`

```typescript
// Add to SourceType union
export type SourceType = 'memory_file' | 'agent_def' | 'skill_def' | 'plan_file' | 'nexus_native' | 'project_doc';

// Add linked_at to Atom interface
export interface Atom {
  // ... existing fields ...
  linked_at: string | null;   // ISO datetime; null = never linked
}

// Add linked_at to Memory interface
export interface Memory {
  // ... existing fields ...
  linked_at: string | null;   // ISO datetime; null = never linked
}

// New type for nexus_crossref results
export interface CrossRefResult {
  id: string;
  title: string;
  atom_type: string;
  link_type: LinkType | null;   // null = found by search, no existing link row
  score: number;                // RRF-merged score, normalized to [0,1]
  body_snippet: string;         // first 300 chars of body
}
```

---

## New File — `src/core/links.ts`

### Types

```typescript
import type Bm25 from 'wink-bm25-text-search';

export type Bm25Index = ReturnType<typeof Bm25>;

export interface RankedResult {
  id: string;
  score: number;   // higher = better
}
```

### Function signatures

```typescript
/**
 * Build an in-memory BM25 corpus from atoms.
 * Indexes: title + body concatenated (both fields weighted equally).
 * Caller owns the returned index — not persisted, not cached.
 */
export function buildBm25Corpus(
  atoms: { id: string; title: string; body: string }[]
): Bm25Index

/**
 * Merge BM25 and dense KNN results using Reciprocal Rank Fusion.
 * K=60 (standard RRF constant). Returns top `topK` items by merged score.
 * Score is the raw RRF value: sum(1/(K+rank)) across lists.
 * Not normalized — callers that need [0,1] must normalize post-merge.
 */
export function rrfMerge(
  bm25Results: RankedResult[],
  denseResults: RankedResult[],
  topK: number = 12,
  K: number = 60
): RankedResult[]

/**
 * Insert or update a bidirectional link between source and target.
 * Inserts (source→target) and (target→source) as two rows.
 * Idempotent: UNIQUE(source_id, target_id, link_type) swallows duplicates.
 * Self-links (sourceId === targetId) are silently skipped.
 * table: 'atom_links' | 'memory_links'
 */
export function upsertLink(
  db: Database.Database,
  sourceId: string,
  targetId: string,
  linkType: LinkType,
  confidence: number,
  table: 'atom_links' | 'memory_links'
): void

/**
 * Link a single atom to similar atoms using hybrid BM25 + dense search.
 * Skips if atom.linked_at > atom.updated_at (already up to date).
 * corpus: optional pre-built BM25 index; if absent, builds one from all atoms.
 * embedFn: injectable for tests.
 * Updates atoms.linked_at on completion.
 */
export async function linkAtom(
  db: Database.Database,
  atomId: string,
  embedFn: (text: string) => Promise<Float32Array | null>,
  corpus?: Bm25Index
): Promise<void>

/**
 * Link a single memory to similar atoms and memories.
 * Skips if memory.linked_at > memory.updated_at.
 * corpus: optional pre-built BM25 index over atoms (memories searched via dense only).
 * Updates memories.linked_at on completion.
 */
export async function linkMemory(
  db: Database.Database,
  memoryId: string,
  embedFn: (text: string) => Promise<Float32Array | null>,
  corpus?: Bm25Index
): Promise<void>
```

### BM25 corpus fields

Index `title + '\n' + body` as a single document per atom. wink-bm25-text-search expects documents as objects; use `{ id, text: title + '\n' + body }` and configure a single field `text`. This captures both title keyword hits (e.g. "CLAUDE.md") and body prose hits with equal weighting — no field-boosting needed at this phase.

### Similarity → link type mapping

```
similarity >= 0.86  →  'duplicates'  confidence = similarity
0.70 <= sim < 0.86  →  'related'     confidence = similarity
sim < 0.70          →  skip (no link)
```

### Skip guard logic inside `linkAtom` / `linkMemory`

```typescript
const row = db.prepare(`SELECT linked_at, updated_at FROM atoms WHERE id = ?`).get(atomId);
if (!row) return;
if (row.linked_at && row.linked_at > row.updated_at) return;  // ISO string comparison is correct for datetime('now')
```

### RRF normalization for `nexus_crossref`

`rrfMerge` returns raw RRF scores. For the `nexus_crossref` output `score` field, normalize: `score = rrfScore / maxRrfScore` where `maxRrfScore` is the highest score in the returned list. If only one result, `score = 1.0`. This gives a [0,1] relative relevance for display.

### Dense KNN query pattern (mirrors `findSimilarMemory`)

```typescript
const rows = db.prepare(`
  SELECT rowid, distance FROM atoms_vec
  WHERE embedding MATCH json(?)
  ORDER BY distance
  LIMIT ?
`).all(JSON.stringify(Array.from(queryVec)), TOP_K) as { rowid: number; distance: number }[];

// L2 distance → cosine similarity (unit vectors)
const similarity = Math.max(0, Math.min(1, 1 - (r.distance * r.distance) / 2));
```

---

## Modified File — `src/indexer/scanner.ts`

### New function

```typescript
import Database from 'better-sqlite3';

/**
 * Discover project .md files from all cwds recorded in the sessions table.
 * Deduplicates cwds before globbing to avoid duplicate SourceFile entries.
 * Ignores node_modules, dist, build, .git.
 */
export function discoverProjectDocs(db: Database.Database): SourceFile[]
```

### Implementation contract

1. `SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL` — deduplicated at query level (no extra `Set<string>` needed)
2. For each cwd, check `existsSync(cwd)` — skip silently if path no longer exists
3. `globSync('**/*.md', { cwd, ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'], absolute: true })`
4. For each path, derive `atom_type` from filename (see rules below) and return `{ path, sourceType: 'project_doc' }`

### `atom_type` derivation rules (checked in order)

| Condition | `atom_type` |
|-----------|-------------|
| Frontmatter has `type:` key → normalize to valid AtomType | that type |
| filename (basename) matches `/^CLAUDE\.md$/i` | `'reference'` |
| filename matches `/^README\.md$/i` | `'reference'` |
| filename matches `/architecture/i` | `'architecture'` |
| filename matches `/\.plan\.md$|^plan/i` | `'plan'` |
| default | `'project_note'` |

The `atom_type` is written into `ParsedFile.atoms[].atom_type` by `parseFile`. For `project_doc` source type, `parseFile` must accept and pass through the derived `atom_type` from the scanner. Implementation: pass `atom_type` override via the `SourceFile` interface extension OR handle it in `parseFile` based on `source_type === 'project_doc'`.

**Simplest approach**: extend `SourceFile` with optional `atomTypeOverride?: AtomType` and pass it into `parseFile`. If present, override the default type derivation. Keeps scanner and parser decoupled.

---

## Modified File — `src/indexer/indexer.ts`

### `runFullIndex` changes

After `discoverSources()`, add:

```typescript
const projectDocs = discoverProjectDocs(db);
const indexProjectDocs = db.transaction(() => {
  for (const source of projectDocs) {
    const result = indexFile(db, stmts, source.path, source.sourceType);
    stats.atomsCreated += result.created;
    stats.atomsUpdated += result.updated;
    stats.atomsUnchanged += result.unchanged;
    // links/diagnostics added normally
  }
});
indexProjectDocs();
```

Place after existing `indexAll()` call, before `postProcess()`, so orphan detection and `inferLinks` include project_doc atoms.

### `embedUnindexed` changes

After the successful `INSERT INTO atoms_vec`, call `linkAtom`:

```typescript
// Build corpus once before the loop (O(N) cost paid once, not per atom)
const allAtoms = db.prepare(`SELECT id, title, body FROM atoms`).all() as
  { id: string; title: string; body: string }[];
const corpus = buildBm25Corpus(allAtoms);

for (const atom of unembedded) {
  // ... existing embed logic ...
  if (vec !== null) {
    db.prepare(`INSERT INTO atoms_vec(rowid, embedding) VALUES (${atom.rowid}, ?)`).run(vecToBlob(vec));
    embedded++;
    await linkAtom(db, atom.id, generateEmbedding, corpus);  // pass pre-built corpus
  }
}
```

Import: `import { linkAtom, buildBm25Corpus } from '../core/links.js';`

---

## Modified File — `src/capture/reflector.ts`

### `reflect()` changes

After `await embedMemory(db, res.id, embed)` succeeds (returns `true`):

```typescript
if (res.inserted) {
  inserted++;
  const embedded = await embedMemory(db, res.id, embed);
  if (embedded) {
    await linkMemory(db, res.id, embed);  // no pre-built corpus — single memory at a time
  }
}
```

Import: `import { linkMemory } from '../core/links.js';`

No corpus pre-build here — `reflect()` processes one memory at a time and doesn't have corpus context. The O(N) cost per memory is acceptable given the low frequency of reflection runs.

---

## Modified File — `src/capture/runner.ts`

### `cwd` persistence

After `INSERT OR IGNORE INTO sessions`, write `cwd` to the row:

```typescript
db.prepare(
  `INSERT OR IGNORE INTO sessions (session_id, project, jsonl_path, status) VALUES (?, ?, ?, 'dead')`
).run(opts.session_id, opts.project ?? 'unknown', opts.transcript_path);

// Persist cwd — written after INSERT OR IGNORE so it applies to both new and existing rows
if (opts.cwd) {
  db.prepare(`UPDATE sessions SET cwd = ? WHERE session_id = ?`).run(opts.cwd, opts.session_id);
}
```

This lives in `reflector.ts` `reflect()` (not `runner.ts`) since `reflect()` owns the session row write. `runner.ts` already passes `cwd` to `reflect()` — no change needed in runner.

---

## New MCP Tool — `nexus_crossref`

Location: `src/mcp/server.ts`, added after `nexus_recall`.

```typescript
server.tool(
  'nexus_crossref',
  'Cross-reference retrieval: find atoms semantically related to a query, annotated with existing link types where available. Uses hybrid BM25 + dense search merged via RRF.',
  {
    query:   z.string().describe('The topic or text to find cross-references for'),
    project: z.string().optional().describe('Filter to a specific project slug'),
    cwd:     z.string().optional().describe('Caller working directory — derives project slug'),
    limit:   z.coerce.number().optional().describe('Max results to return (default: 10)'),
  },
  async ({ query, project, cwd, limit }): Promise<{ content: { type: 'text'; text: string }[] }> => {
    const cap = limit ?? 10;
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(cwd) : undefined);

    // 1. Dense KNN
    const queryVec = await generateEmbedding(query);
    const denseResults: RankedResult[] = [];
    if (queryVec) {
      // ... KNN over atoms_vec, build denseResults ...
    }

    // 2. BM25 search
    const allAtoms = db.prepare(`SELECT id, title, body FROM atoms`).all();
    const corpus = buildBm25Corpus(allAtoms);
    const bm25Results: RankedResult[] = corpus.search(query, cap * 2);

    // 3. RRF merge
    const merged = rrfMerge(bm25Results, denseResults, cap);

    if (merged.length === 0) {
      return { content: [{ type: 'text', text: 'No cross-references found.' }] };
    }

    // 4. Normalize scores
    const maxScore = merged[0].score;
    const normalized = merged.map(r => ({ ...r, score: maxScore > 0 ? r.score / maxScore : 0 }));

    // 5. Fetch atom details + JOIN atom_links for link annotation
    const ids = normalized.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');

    const atoms = db.prepare(
      `SELECT a.id, a.title, a.atom_type, a.body FROM atoms a WHERE a.id IN (${placeholders})`
    ).all(...ids) as { id: string; title: string; atom_type: string; body: string }[];

    // source_id IN (ids) OR target_id IN (ids) — get all link rows touching these atoms
    const links = db.prepare(
      `SELECT source_id, target_id, link_type FROM atom_links
       WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`
    ).all(...ids, ...ids) as { source_id: string; target_id: string; link_type: string }[];

    // Build link_type lookup: atomId → link_type (take first match)
    const linkMap = new Map<string, string>();
    for (const l of links) {
      if (!linkMap.has(l.source_id)) linkMap.set(l.source_id, l.link_type);
      if (!linkMap.has(l.target_id)) linkMap.set(l.target_id, l.link_type);
    }

    // 6. Build CrossRefResult[]
    const atomMap = new Map(atoms.map(a => [a.id, a]));
    const results: CrossRefResult[] = normalized
      .map(r => {
        const atom = atomMap.get(r.id);
        if (!atom) return null;
        return {
          id: atom.id,
          title: atom.title,
          atom_type: atom.atom_type,
          link_type: (linkMap.get(atom.id) as LinkType) ?? null,
          score: r.score,
          body_snippet: atom.body.slice(0, 300),
        };
      })
      .filter((r): r is CrossRefResult => r !== null);

    if (effectiveProject) {
      // Filter to project scope if requested
      // (query atoms with project filter, or post-filter results)
    }

    const text = results
      .map(r => {
        const linkBadge = r.link_type ? ` [${r.link_type}]` : '';
        return `### ${r.title}${linkBadge}\n_${r.atom_type} | score: ${r.score.toFixed(2)}_\n\n${r.body_snippet}`;
      })
      .join('\n\n');

    return { content: [{ type: 'text', text }] };
  }
);
```

Imports needed in `server.ts`:
- `import { buildBm25Corpus, rrfMerge, type RankedResult } from '../core/links.js';`
- `import { generateEmbedding } from '../core/embeddings.js';`
- `import type { CrossRefResult, LinkType } from '../core/types.js';`

---

## Data Flow

```
runner.ts argv[2]=cwd
  → reflect(db, { cwd })
      → INSERT OR IGNORE sessions row
      → UPDATE sessions SET cwd = ? WHERE session_id = ?
      → extractMemories → insertMemory → embedMemory → linkMemory(db, id, embed)
          → linkMemory reads memories.linked_at vs updated_at (skip guard)
          → dense KNN over memories_vec + BM25 over in-memory atom corpus
          → rrfMerge → top 12 candidates
          → upsertLink(db, memId, targetId, linkType, conf, 'memory_links') (bidirectional)
          → UPDATE memories SET linked_at = datetime('now')

runFullIndex(db)
  → discoverSources() + discoverProjectDocs(db)
      → discoverProjectDocs: SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL
      → globSync('**/*.md', { ignore: [...] }) per cwd
      → return SourceFile[] with sourceType='project_doc'
  → indexFile(db, stmts, path, 'project_doc')
      → parseFile → atom_type derived from filename/frontmatter
      → upsertAtom with source_type='project_doc'
  → embedUnindexed(db)
      → buildBm25Corpus(allAtoms)  ← O(N) once
      → for each unembedded atom:
          → generateEmbedding(title+body)
          → INSERT INTO atoms_vec
          → linkAtom(db, id, embedFn, corpus)  ← pass pre-built corpus
              → atoms.linked_at skip guard
              → dense KNN over atoms_vec (TOP_K=12)
              → BM25 search on passed corpus (TOP_K=12)
              → rrfMerge → top 12
              → similarity threshold → linkType
              → upsertLink(db, atomId, targetId, linkType, conf, 'atom_links') (bidirectional)
              → UPDATE atoms SET linked_at = datetime('now')

nexus_crossref MCP tool
  → generateEmbedding(query) → queryVec
  → KNN over atoms_vec (TOP_K=12 * 2)
  → buildBm25Corpus(allAtoms) → BM25 search (TOP_K=12 * 2)
  → rrfMerge(bm25, dense, limit)
  → normalize scores to [0,1]
  → JOIN atom_links → annotate link_type (null if no row)
  → return CrossRefResult[]
```

---

## `package.json` Change

Add to `dependencies`:
```json
"wink-bm25-text-search": "^2.3.0"
```

Also add type declaration (if needed):
```json
"@types/wink-bm25-text-search": "..."
```

wink-bm25-text-search is pure JS (zero native deps). Check if `@types/wink-bm25-text-search` exists on npm; if not, add a local `src/types/wink-bm25-text-search.d.ts` shim:
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

---

## Test Architecture

### `src/core/links.test.ts` — New

**Coverage**: `rrfMerge`, `upsertLink`, `linkAtom` (skip guard, self-link prevention)  
**Mocks**: in-memory sqlite DB via `openDatabase(':memory:')` + `initializeSchema`; `embedFn` injected as fake returning deterministic `Float32Array`

Tests:
1. `rrfMerge`: result appearing in both lists ranks above result in only one
2. `rrfMerge`: empty dense list → BM25 results still returned; vice versa
3. `upsertLink`: inserts two rows (A→B and B→A); second call is idempotent (row count unchanged)
4. `upsertLink`: self-link (A→A) is skipped — zero rows inserted
5. `linkAtom`: atom with `linked_at > updated_at` → no `atom_links` rows written
6. `linkAtom`: atom without `linked_at` → `atom_links` rows written when similar atom exists
7. `linkAtom`: similarity >= 0.86 → `link_type = 'duplicates'`; 0.70–0.86 → `link_type = 'related'`
8. `buildBm25Corpus`: returns corpus that scores exact-title match above unrelated doc

### `src/indexer/scanner.test.ts` — Extend existing (or new)

**Coverage**: `discoverProjectDocs`  
**Mocks**: `mkdtempSync` temp dirs as fake cwds; in-memory DB with cwd rows seeded

Tests:
1. Returns `SourceFile[]` for all `.md` files under each cwd in sessions
2. Ignores `node_modules/`, `dist/`, `build/`, `.git/` paths
3. Deduplicates: two sessions with same cwd → each md file appears once
4. Missing/nonexistent cwd in sessions → skipped silently (no throw)
5. Session with `cwd IS NULL` → excluded from query

### `src/integration.test.ts` — Extend existing

**Coverage**: index project_doc → embed → link → verify atom_links populated  
**Pattern**: matches existing `freshDb()` + `vecFromText()` pattern

New test block:
```
describe('project_doc corpus expansion', () => {
  it('indexes project .md, embeds, links, writes atom_links', async () => {
    // 1. Create temp dir with two .md files
    // 2. Seed sessions table with cwd = temp dir
    // 3. Call discoverProjectDocs(db) → verify 2 SourceFiles
    // 4. indexFile each → verify atoms with source_type='project_doc'
    // 5. Call embedUnindexed with fake embedFn (vecFromText)
    // 6. Verify atom_links has at least one row with source_id or target_id matching our atoms
    // 7. Verify atoms.linked_at is set (not null)
  })
})
```

### `src/core/database.test.ts` — Extend existing

**Coverage**: migration 6

Tests:
1. Fresh DB → `columnExists(db, 'sessions', 'cwd')` is true
2. Fresh DB → `columnExists(db, 'atoms', 'linked_at')` is true
3. Fresh DB → `columnExists(db, 'memories', 'linked_at')` is true
4. Atom insert with `source_type='project_doc'` succeeds (no CHECK violation)
5. Atom insert with `source_type='invalid_type'` throws

---

## Upsert Session Statement Update

The `upsertSession` prepared statement in `indexer.ts` does not currently include `cwd`. It must be updated to preserve `cwd` on conflict (not overwrite it, since the indexer doesn't know the cwd — only the reflector does):

```sql
ON CONFLICT(session_id) DO UPDATE SET
  last_active = @last_active,
  status = @status,
  message_count = @message_count,
  subagent_count = @subagent_count,
  summary = COALESCE(@summary, sessions.summary),
  title = COALESCE(sessions.custom_title, @title, sessions.title)
  -- cwd deliberately excluded: reflector owns it, indexer must not overwrite
```

No change needed — the existing `upsertSession` already excludes `cwd` from the `DO UPDATE SET` list (since `cwd` is a new column), so the indexer will never clobber cwd written by the reflector.

---

## Constraint Checklist

- [x] Tech stack: TypeScript, better-sqlite3, sqlite-vec, existing migration framework
- [x] Zero native deps for BM25: wink-bm25-text-search (pure JS)
- [x] Scope: Features 1–4 only
- [x] Schema changes via migration 6 with guarded ALTER / recreate pattern
- [x] Bidirectional links: upsertLink inserts both directions
- [x] No re-link on every run: linked_at skip guard in linkAtom/linkMemory
- [x] BM25 corpus in-memory only, never persisted
- [x] Self-links prevented in upsertLink
- [x] nexus_crossref returns link_type: null for unlinked hits (field present, null value)
- [x] discoverProjectDocs deduplicates cwds at SQL level (DISTINCT)

---

## Checkpoint

Files to create or modify:

| File | Action |
|------|--------|
| `src/core/database.ts` | Add migration 6 (migrateCorpusExpansion), update MIGRATIONS array, update LATEST_SCHEMA_VERSION to 6 |
| `src/core/types.ts` | Add `'project_doc'` to SourceType; add `linked_at?: string \| null` to Atom and Memory; add CrossRefResult interface |
| `src/core/links.ts` | New file — rrfMerge, buildBm25Corpus, linkAtom, linkMemory, upsertLink |
| `src/capture/reflector.ts` | Add cwd UPDATE after INSERT OR IGNORE; call linkMemory after embedMemory |
| `src/indexer/scanner.ts` | Add discoverProjectDocs(db); extend SourceFile with atomTypeOverride? |
| `src/indexer/indexer.ts` | Call discoverProjectDocs in runFullIndex; pre-build corpus + call linkAtom in embedUnindexed |
| `src/mcp/server.ts` | Add nexus_crossref tool; import links.ts exports |
| `package.json` | Add wink-bm25-text-search dependency |
| `src/core/links.test.ts` | New — unit tests for rrfMerge, upsertLink, linkAtom |
| `src/indexer/scanner.test.ts` | New or extend — discoverProjectDocs unit tests |
| `src/integration.test.ts` | Extend with project_doc → embed → link → verify flow |
| `src/core/database.test.ts` | Extend with migration 6 column/constraint assertions |
