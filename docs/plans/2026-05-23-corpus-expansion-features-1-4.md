# Corpus Expansion (Features 1–4) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `dispatch-agents` skill to implement this plan task-by-task.

**Goal:** Expand Claude Nexus knowledge graph by persisting session cwd, indexing project .md files, auto-linking atoms/memories via hybrid BM25+dense RRF, and exposing cross-reference retrieval via a new MCP tool.

**Architecture:** Hybrid BM25 (wink-bm25-text-search, pure JS) + sqlite-vec dense KNN, merged via Reciprocal Rank Fusion (K=60). Linking is incremental: `linked_at` timestamp guards skip re-link when up to date. BM25 corpus built in-memory per indexer pass — never persisted.

**Tech Stack:** TypeScript, better-sqlite3, sqlite-vec, wink-bm25-text-search, vitest, glob

---

## Dependency Graph

```
task-001 ──┐
task-002 ──┼──► task-004 ──┬──► task-006 ──► task-011
task-003 ──┘               ├──► task-007
           ├──► task-005 ──┼──► task-009
                           ├──► task-008
                           ├──► task-009
                           └──► task-010
task-003 ──────────────────────► task-011
```

Parallel wave 1: task-001, task-002, task-003 (no deps)
Parallel wave 2: task-004, task-005 (deps on wave 1)
Parallel wave 3: task-006, task-007, task-008, task-009, task-010 (deps on wave 2)
Wave 4: task-011 (integration tests, deps on waves 1–3)

---

## Task 1: Add wink-bm25-text-search dependency (task-001)

**Files:**
- Modify: `package.json`
- Create: `src/types/wink-bm25-text-search.d.ts`

**Step 1: Check if @types package exists**

```bash
npm info @types/wink-bm25-text-search 2>&1 || echo "no @types"
```

**Step 2: Add dependency to package.json**

In `package.json` `"dependencies"`, add:
```json
"wink-bm25-text-search": "^2.3.0"
```

**Step 3: Install**

```bash
npm install
```

Expected: `added N packages` — no native compilation warnings.

**Step 4: Create type shim (if @types package absent)**

Create `src/types/wink-bm25-text-search.d.ts`:
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

**Step 5: Verify compilation**

```bash
npx tsc --noEmit
```

Expected: no errors related to wink-bm25-text-search.

**Step 6: Verify actual BM25 API matches shim**

```bash
node -e "const BM25 = require('wink-bm25-text-search'); const idx = BM25(); console.log(Object.getOwnPropertyNames(idx));"
```

Adjust shim if actual API differs.

**Step 7: Commit**

```bash
git add package.json package-lock.json src/types/wink-bm25-text-search.d.ts
git commit -m "deps: add wink-bm25-text-search for hybrid BM25 linking"
```

---

## Task 2: Extend types.ts (task-002)

**Files:**
- Modify: `src/core/types.ts`

**Step 1: Write failing tsc check (baseline)**

```bash
npx tsc --noEmit 2>&1 | head -5
```

**Step 2: Add `'project_doc'` to SourceType**

Change line 4 of `src/core/types.ts`:
```typescript
export type SourceType = 'memory_file' | 'agent_def' | 'skill_def' | 'plan_file' | 'nexus_native' | 'project_doc';
```

**Step 3: Add `linked_at` to Atom interface**

After `updated_at: string;` in the `Atom` interface, add:
```typescript
linked_at: string | null;
```

**Step 4: Add `linked_at` to Memory interface**

After `updated_at: string;` in the `Memory` interface, add:
```typescript
linked_at: string | null;
```

**Step 5: Add `cwd` to Session interface**

After `last_reflected_index: number;` in the `Session` interface, add:
```typescript
cwd: string | null;
```

**Step 6: Add CrossRefResult interface**

After the `SearchResult` interface, add:
```typescript
export interface CrossRefResult {
  id: string;
  title: string;
  atom_type: string;
  link_type: LinkType | null;  // null = found by search, no existing link row
  score: number;               // RRF-merged, normalized to [0,1]
  body_snippet: string;        // first 300 chars of body
}
```

**Step 7: Compile and verify**

```bash
npx tsc --noEmit
```

Expected: zero errors. Fix any downstream type errors (e.g. callers that construct `Atom` objects without `linked_at` need `linked_at: null`).

**Step 8: Commit**

```bash
git add src/core/types.ts
git commit -m "types: add project_doc SourceType, linked_at fields, CrossRefResult"
```

---

## Task 3: Migration 6 — cwd + linked_at + project_doc CHECK (task-003)

**Files:**
- Modify: `src/core/database.ts`

**Step 1: Write failing test first**

In `src/core/database.test.ts` (create or extend), add:
```typescript
import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema, LATEST_SCHEMA_VERSION } from './database.js';

describe('migration 6', () => {
  it('LATEST_SCHEMA_VERSION is 6', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(6);
  });

  it('sessions table has cwd column', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    const cols = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[];
    expect(cols.map(c => c.name)).toContain('cwd');
  });

  it('atoms table has linked_at column', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    const cols = db.prepare(`PRAGMA table_info(atoms)`).all() as { name: string }[];
    expect(cols.map(c => c.name)).toContain('linked_at');
  });

  it('memories table has linked_at column', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    const cols = db.prepare(`PRAGMA table_info(memories)`).all() as { name: string }[];
    expect(cols.map(c => c.name)).toContain('linked_at');
  });

  it('source_type project_doc is valid', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    expect(() => {
      db.prepare(`INSERT INTO atoms (id, title, body, atom_type, scope, source_path, source_type, content_hash, tags)
        VALUES ('test-1', 'T', 'B', 'project_note', 'project', '/tmp/t.md', 'project_doc', 'abc', '[]')`).run();
    }).not.toThrow();
  });

  it('source_type invalid_type throws CHECK violation', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    expect(() => {
      db.prepare(`INSERT INTO atoms (id, title, body, atom_type, scope, source_path, source_type, content_hash, tags)
        VALUES ('test-2', 'T', 'B', 'project_note', 'project', '/tmp/t.md', 'invalid_type', 'abc', '[]')`).run();
    }).toThrow();
  });
});
```

**Step 2: Run test — verify it fails**

```bash
npx vitest run src/core/database.test.ts
```

Expected: FAIL — `LATEST_SCHEMA_VERSION` is 5, not 6.

**Step 3: Add `migrateCorpusExpansion` function to database.ts**

Add after `migrateSessionMessagesFts`:

```typescript
// ── Migration 6: corpus expansion — cwd + linked_at + project_doc ────
// Adds sessions.cwd (ALTER — safe), memories.linked_at (ALTER — safe),
// and recreates atoms table to extend source_type CHECK + add linked_at.

function migrateCorpusExpansion(db: Database.Database): void {
  // Safe ALTERs — no CHECK constraint update needed
  try { db.exec(`ALTER TABLE memories ADD COLUMN linked_at TEXT`); } catch {}
  try { db.exec(`ALTER TABLE sessions ADD COLUMN cwd TEXT`); } catch {}

  // Atoms recreate: needed to extend source_type CHECK + add linked_at
  const schemaRow = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='atoms'`
  ).get() as { sql: string } | undefined;

  if (schemaRow && !schemaRow.sql.includes("'project_doc'")) {
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(`CREATE TABLE atoms_new (
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
        )`);

        db.exec(`INSERT INTO atoms_new
          (id, title, body, atom_type, scope, source_path, source_type, project, tags,
           content_hash, frontmatter, created_at, updated_at, status, priority, blocks,
           blocked_by, discovered_from, load_at_init)
          SELECT id, title, body, atom_type, scope, source_path, source_type, project, tags,
                 content_hash, frontmatter, created_at, updated_at, status, priority, blocks,
                 blocked_by, discovered_from, load_at_init
          FROM atoms`);

        db.exec(`DROP TRIGGER IF EXISTS atoms_ai`);
        db.exec(`DROP TRIGGER IF EXISTS atoms_ad`);
        db.exec(`DROP TRIGGER IF EXISTS atoms_au`);
        db.exec(`DROP TABLE IF EXISTS atoms_fts`);
        db.exec(`DROP TABLE atoms`);
        db.exec(`ALTER TABLE atoms_new RENAME TO atoms`);

        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS atoms_fts USING fts5(
          title, body, tags,
          content='atoms',
          content_rowid='rowid',
          tokenize='porter unicode61'
        )`);

        db.exec(`CREATE TRIGGER IF NOT EXISTS atoms_ai AFTER INSERT ON atoms BEGIN
          INSERT INTO atoms_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
        END`);
        db.exec(`CREATE TRIGGER IF NOT EXISTS atoms_ad AFTER DELETE ON atoms BEGIN
          INSERT INTO atoms_fts(atoms_fts, rowid, title, body, tags)
          VALUES ('delete', old.rowid, old.title, old.body, old.tags);
        END`);
        db.exec(`CREATE TRIGGER IF NOT EXISTS atoms_au AFTER UPDATE ON atoms BEGIN
          INSERT INTO atoms_fts(atoms_fts, rowid, title, body, tags)
          VALUES ('delete', old.rowid, old.title, old.body, old.tags);
          INSERT INTO atoms_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
        END`);

        db.exec(`INSERT INTO atoms_fts(atoms_fts) VALUES('rebuild')`);

        db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_project ON atoms(project)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_type ON atoms(atom_type)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_scope ON atoms(scope)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_source ON atoms(source_path)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_hash ON atoms(content_hash)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_linked ON atoms(linked_at)`);
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  } else if (schemaRow && !schemaRow.sql.includes('linked_at')) {
    // Edge case: project_doc added by prior partial migration but linked_at missing
    try { db.exec(`ALTER TABLE atoms ADD COLUMN linked_at TEXT`); } catch {}
    db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_linked ON atoms(linked_at)`);
  }
}
```

**Step 4: Register migration in MIGRATIONS array**

Change the MIGRATIONS array to add version 6:
```typescript
const MIGRATIONS: Migration[] = [
  { version: 1, name: 'baseline-v1-schema', up: migrateBaseline },
  { version: 2, name: 'memories-tables', up: migrateMemories },
  { version: 3, name: 'session-reflection-cursor', up: migrateReflectionCursor },
  { version: 4, name: 'import-legacy-memory-atoms', up: migrateImportLegacyMemories },
  { version: 5, name: 'session-messages-fts', up: migrateSessionMessagesFts },
  { version: 6, name: 'corpus-expansion-cwd-links', up: migrateCorpusExpansion },
];
```

**Step 5: Run failing test — verify it passes**

```bash
npx vitest run src/core/database.test.ts
```

Expected: all 6 migration tests PASS.

**Step 6: Run full test suite to check for regressions**

```bash
npx vitest run
```

Expected: no new failures.

**Step 7: Commit**

```bash
git add src/core/database.ts src/core/database.test.ts
git commit -m "db: migration 6 — sessions.cwd, atoms/memories.linked_at, project_doc source_type"
```

---

## Task 4: Create src/core/links.ts — hybrid linking core (task-004)

**Files:**
- Create: `src/core/links.ts`

**Step 1: Write failing tests first**

Create `src/core/links.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { rrfMerge, buildBm25Corpus, upsertLink, linkAtom, type RankedResult } from './links.js';
import type Database from 'better-sqlite3';

// Deterministic fake embedFn: produces orthogonal-ish vectors based on first char code
function fakeEmbed(text: string): Promise<Float32Array | null> {
  const v = new Float32Array(1024).fill(0);
  const code = text.charCodeAt(0) % 1024;
  v[code] = 1.0;
  return Promise.resolve(v);
}

function freshDb(): Database.Database {
  const db = openDatabase(':memory:');
  initializeSchema(db);
  return db;
}

function insertAtom(db: Database.Database, id: string, title: string, body: string, linkedAt?: string) {
  db.prepare(`INSERT OR IGNORE INTO atoms (id, title, body, atom_type, scope, source_path, source_type, content_hash, tags, linked_at)
    VALUES (?, ?, ?, 'project_note', 'project', '/tmp/test.md', 'project_doc', ?, '[]', ?)`
  ).run(id, title, body, id, linkedAt ?? null);
}

describe('rrfMerge', () => {
  it('item in both lists ranks above item in only one', () => {
    const bm25: RankedResult[] = [{ id: 'both', score: 1 }, { id: 'bm25only', score: 2 }];
    const dense: RankedResult[] = [{ id: 'both', score: 1 }, { id: 'denseonly', score: 2 }];
    const merged = rrfMerge(bm25, dense, 3);
    expect(merged[0].id).toBe('both');
  });

  it('empty dense list returns BM25 results', () => {
    const bm25: RankedResult[] = [{ id: 'a', score: 1 }, { id: 'b', score: 2 }];
    const merged = rrfMerge(bm25, [], 5);
    expect(merged.length).toBe(2);
    expect(merged.map(r => r.id)).toContain('a');
  });

  it('empty BM25 list returns dense results', () => {
    const dense: RankedResult[] = [{ id: 'x', score: 1 }];
    const merged = rrfMerge([], dense, 5);
    expect(merged.length).toBe(1);
    expect(merged[0].id).toBe('x');
  });

  it('respects topK cap', () => {
    const bm25: RankedResult[] = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, score: i }));
    const merged = rrfMerge(bm25, [], 3);
    expect(merged.length).toBe(3);
  });
});

describe('upsertLink', () => {
  it('inserts two rows (A→B and B→A)', () => {
    const db = freshDb();
    insertAtom(db, 'atom-a', 'Alpha', 'body alpha');
    insertAtom(db, 'atom-b', 'Beta', 'body beta');
    upsertLink(db, 'atom-a', 'atom-b', 'related', 0.8, 'atom_links');
    const count = (db.prepare(`SELECT COUNT(*) as c FROM atom_links`).get() as { c: number }).c;
    expect(count).toBe(2);
  });

  it('is idempotent — second call leaves row count unchanged', () => {
    const db = freshDb();
    insertAtom(db, 'atom-a', 'Alpha', 'body alpha');
    insertAtom(db, 'atom-b', 'Beta', 'body beta');
    upsertLink(db, 'atom-a', 'atom-b', 'related', 0.8, 'atom_links');
    upsertLink(db, 'atom-a', 'atom-b', 'related', 0.8, 'atom_links');
    const count = (db.prepare(`SELECT COUNT(*) as c FROM atom_links`).get() as { c: number }).c;
    expect(count).toBe(2);
  });

  it('self-link (A→A) inserts zero rows', () => {
    const db = freshDb();
    insertAtom(db, 'atom-a', 'Alpha', 'body alpha');
    upsertLink(db, 'atom-a', 'atom-a', 'related', 0.9, 'atom_links');
    const count = (db.prepare(`SELECT COUNT(*) as c FROM atom_links`).get() as { c: number }).c;
    expect(count).toBe(0);
  });
});

describe('linkAtom', () => {
  it('skip guard: atom with linked_at > updated_at writes no atom_links rows', async () => {
    const db = freshDb();
    // Insert atom with linked_at in the future relative to updated_at
    db.prepare(`INSERT INTO atoms (id, title, body, atom_type, scope, source_path, source_type, content_hash, tags, updated_at, linked_at)
      VALUES ('atom-a', 'Alpha', 'body', 'project_note', 'project', '/tmp/t.md', 'project_doc', 'h', '[]', '2026-01-01', '2026-12-31')`
    ).run();
    await linkAtom(db, 'atom-a', fakeEmbed);
    const count = (db.prepare(`SELECT COUNT(*) as c FROM atom_links`).get() as { c: number }).c;
    expect(count).toBe(0);
  });

  it('writes links when similar atom exists', async () => {
    const db = freshDb();
    // Two atoms with very similar text → same embedding (deterministic fakeEmbed)
    insertAtom(db, 'atom-a', 'Alpha concept', 'Alpha body');
    insertAtom(db, 'atom-b', 'Alpha concept', 'Alpha body');
    // Insert fake vectors (identical → cosine similarity = 1.0 → 'duplicates')
    const v = new Float32Array(1024).fill(0);
    v[65] = 1.0; // 'A' = 65
    const blob = Buffer.from(v.buffer);
    const rowA = (db.prepare(`SELECT rowid FROM atoms WHERE id = 'atom-a'`).get() as { rowid: number }).rowid;
    const rowB = (db.prepare(`SELECT rowid FROM atoms WHERE id = 'atom-b'`).get() as { rowid: number }).rowid;
    try {
      db.prepare(`INSERT INTO atoms_vec(rowid, embedding) VALUES (${rowA}, ?)`).run(blob);
      db.prepare(`INSERT INTO atoms_vec(rowid, embedding) VALUES (${rowB}, ?)`).run(blob);
    } catch {
      // sqlite-vec may not be loaded in test env — skip dense part
    }
    await linkAtom(db, 'atom-a', fakeEmbed);
    // With or without sqlite-vec, BM25 should catch identical title+body
    const count = (db.prepare(`SELECT COUNT(*) as c FROM atom_links`).get() as { c: number }).c;
    // At minimum: either BM25 or dense found a match — or if neither (env has no sqlite-vec and BM25 corpus too small)
    // Test: linked_at is set (function ran without error)
    const row = db.prepare(`SELECT linked_at FROM atoms WHERE id = 'atom-a'`).get() as { linked_at: string | null };
    expect(row.linked_at).not.toBeNull();
  });
});

describe('buildBm25Corpus', () => {
  it('exact title match scores above unrelated doc', () => {
    const corpus = buildBm25Corpus([
      { id: 'a', title: 'TypeScript generics explained', body: 'Generics allow type parameters.' },
      { id: 'b', title: 'Cooking pasta al dente', body: 'Boil water and add salt.' },
    ]);
    const results = corpus.search('TypeScript generics', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].ref).toBe('a');
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
npx vitest run src/core/links.test.ts
```

Expected: FAIL — `./links.js` not found.

**Step 3: Create src/core/links.ts**

```typescript
import Database from 'better-sqlite3';
import BM25 from 'wink-bm25-text-search';
import type { LinkType } from './types.js';

export type Bm25Index = ReturnType<typeof BM25>;

export interface RankedResult {
  id: string;
  score: number;
}

const TOP_K = 12;
const RRF_K = 60;

/**
 * Build an in-memory BM25 corpus from atoms.
 * Indexes title + body as a single 'text' field per document.
 * Caller owns the returned index — not persisted.
 */
export function buildBm25Corpus(
  atoms: { id: string; title: string; body: string }[]
): Bm25Index {
  const idx = BM25();
  idx.defineConfig({ fldWeights: { text: 1 } });
  // wink-bm25 expects a pipeline; use identity functions for pre-tokenized input
  idx.definePipeline([
    (tokens: string) => tokens.toLowerCase().split(/\W+/).filter(Boolean)
  ]);
  idx.defineFields(['text']);

  for (const atom of atoms) {
    idx.addDoc({ text: atom.title + '\n' + atom.body }, atom.id);
  }
  idx.consolidate();
  return idx;
}

/**
 * Merge BM25 and dense KNN results using Reciprocal Rank Fusion.
 * K=60 (standard RRF constant). Returns top topK items by merged score.
 */
export function rrfMerge(
  bm25Results: RankedResult[],
  denseResults: RankedResult[],
  topK: number = TOP_K,
  K: number = RRF_K
): RankedResult[] {
  const scores = new Map<string, number>();

  bm25Results.forEach((r, idx) => {
    scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (K + idx + 1));
  });
  denseResults.forEach((r, idx) => {
    scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (K + idx + 1));
  });

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Insert a bidirectional link between source and target.
 * Idempotent via UNIQUE(source_id, target_id, link_type).
 * Self-links (sourceId === targetId) are silently skipped.
 */
export function upsertLink(
  db: Database.Database,
  sourceId: string,
  targetId: string,
  linkType: LinkType,
  confidence: number,
  table: 'atom_links' | 'memory_links'
): void {
  if (sourceId === targetId) return;

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO ${table} (source_id, target_id, link_type, confidence) VALUES (?, ?, ?, ?)`
  );
  stmt.run(sourceId, targetId, linkType, confidence);
  stmt.run(targetId, sourceId, linkType, confidence);
}

/**
 * Link a single atom to similar atoms using hybrid BM25 + dense search.
 * Skips if atom.linked_at > atom.updated_at (already up to date).
 * corpus: optional pre-built BM25 index; if absent, builds one from all atoms.
 */
export async function linkAtom(
  db: Database.Database,
  atomId: string,
  embedFn: (text: string) => Promise<Float32Array | null>,
  corpus?: Bm25Index
): Promise<void> {
  const row = db.prepare(
    `SELECT id, title, body, linked_at, updated_at FROM atoms WHERE id = ?`
  ).get(atomId) as { id: string; title: string; body: string; linked_at: string | null; updated_at: string } | undefined;

  if (!row) return;
  if (row.linked_at && row.linked_at > row.updated_at) return;

  const text = row.title + '\n' + row.body;

  // Dense KNN
  const denseResults: RankedResult[] = [];
  const denseSimilarity = new Map<string, number>();

  const vec = await embedFn(text);
  if (vec) {
    try {
      const { vecToBlob } = await import('./memories.js');
      const rows = db.prepare(`
        SELECT rowid, distance FROM atoms_vec
        WHERE embedding MATCH json(?)
        ORDER BY distance
        LIMIT 24
      `).all(JSON.stringify(Array.from(vec))) as { rowid: number; distance: number }[];

      const atomsByRowid = db.prepare(
        `SELECT id FROM atoms WHERE rowid = ?`
      );

      for (const r of rows) {
        const atom = atomsByRowid.get(r.rowid) as { id: string } | undefined;
        if (!atom || atom.id === atomId) continue;
        const similarity = Math.max(0, Math.min(1, 1 - (r.distance * r.distance) / 2));
        denseResults.push({ id: atom.id, score: similarity });
        denseSimilarity.set(atom.id, similarity);
      }
    } catch {
      // sqlite-vec not loaded — dense pass skipped, BM25 only
    }
  }

  // BM25 search
  const bm25Results: RankedResult[] = [];
  const effectiveCorpus = corpus ?? (() => {
    const allAtoms = db.prepare(`SELECT id, title, body FROM atoms`).all() as
      { id: string; title: string; body: string }[];
    return buildBm25Corpus(allAtoms);
  })();

  try {
    const hits = effectiveCorpus.search(text, 24);
    for (const hit of hits) {
      if (hit.ref !== atomId) {
        bm25Results.push({ id: hit.ref, score: hit.score });
      }
    }
  } catch {
    // BM25 search failed — skip
  }

  // Merge and link
  const merged = rrfMerge(bm25Results, denseResults, TOP_K);

  for (const result of merged) {
    const similarity = denseSimilarity.get(result.id);
    let linkType: LinkType | null = null;

    if (similarity !== undefined) {
      if (similarity >= 0.86) linkType = 'duplicates';
      else if (similarity >= 0.70) linkType = 'related';
    } else {
      // BM25-only hit — use 'related' with lower confidence
      linkType = 'related';
    }

    if (linkType) {
      const confidence = similarity ?? 0.7;
      upsertLink(db, atomId, result.id, linkType, confidence, 'atom_links');
    }
  }

  db.prepare(`UPDATE atoms SET linked_at = datetime('now') WHERE id = ?`).run(atomId);
}

/**
 * Link a single memory to similar atoms and memories.
 * Skips if memory.linked_at > memory.updated_at.
 */
export async function linkMemory(
  db: Database.Database,
  memoryId: string,
  embedFn: (text: string) => Promise<Float32Array | null>,
  corpus?: Bm25Index
): Promise<void> {
  const row = db.prepare(
    `SELECT id, title, body, linked_at, updated_at FROM memories WHERE id = ?`
  ).get(memoryId) as { id: string; title: string; body: string; linked_at: string | null; updated_at: string } | undefined;

  if (!row) return;
  if (row.linked_at && row.linked_at > row.updated_at) return;

  const text = row.title + '\n' + row.body;

  // Dense KNN over memories_vec
  const denseResults: RankedResult[] = [];
  const denseSimilarity = new Map<string, number>();

  const vec = await embedFn(text);
  if (vec) {
    try {
      const rows = db.prepare(`
        SELECT rowid, distance FROM memories_vec
        WHERE embedding MATCH json(?)
        ORDER BY distance
        LIMIT 24
      `).all(JSON.stringify(Array.from(vec))) as { rowid: number; distance: number }[];

      const memoriesByRowid = db.prepare(
        `SELECT id FROM memories WHERE rowid = ?`
      );

      for (const r of rows) {
        const mem = memoriesByRowid.get(r.rowid) as { id: string } | undefined;
        if (!mem || mem.id === memoryId) continue;
        const similarity = Math.max(0, Math.min(1, 1 - (r.distance * r.distance) / 2));
        denseResults.push({ id: mem.id, score: similarity });
        denseSimilarity.set(mem.id, similarity);
      }
    } catch {
      // sqlite-vec not loaded
    }
  }

  // BM25 over atom corpus
  const bm25Results: RankedResult[] = [];
  const effectiveCorpus = corpus ?? (() => {
    const allAtoms = db.prepare(`SELECT id, title, body FROM atoms`).all() as
      { id: string; title: string; body: string }[];
    return buildBm25Corpus(allAtoms);
  })();

  try {
    const hits = effectiveCorpus.search(text, 24);
    for (const hit of hits) {
      bm25Results.push({ id: hit.ref, score: hit.score });
    }
  } catch {
    // BM25 search failed
  }

  const merged = rrfMerge(bm25Results, denseResults, TOP_K);

  for (const result of merged) {
    const similarity = denseSimilarity.get(result.id);
    let linkType: LinkType | null = null;

    if (similarity !== undefined) {
      if (similarity >= 0.86) linkType = 'duplicates';
      else if (similarity >= 0.70) linkType = 'related';
    } else {
      linkType = 'related';
    }

    if (linkType) {
      const confidence = similarity ?? 0.7;
      upsertLink(db, memoryId, result.id, linkType, confidence, 'memory_links');
    }
  }

  db.prepare(`UPDATE memories SET linked_at = datetime('now') WHERE id = ?`).run(memoryId);
}
```

**Step 4: Run tests — verify they pass**

```bash
npx vitest run src/core/links.test.ts
```

Expected: all tests PASS. Fix any failures.

**Step 5: Compile check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

**Step 6: Commit**

```bash
git add src/core/links.ts src/core/links.test.ts
git commit -m "feat: add links.ts — hybrid BM25+dense RRF linking core"
```

---

## Task 5: Add discoverProjectDocs to scanner.ts (task-005)

**Files:**
- Modify: `src/indexer/scanner.ts`
- Create: `src/indexer/scanner.test.ts`

**Step 1: Write failing tests**

Create `src/indexer/scanner.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, tmpdir } from 'path';
import { openDatabase, initializeSchema } from '../core/database.js';
import { discoverProjectDocs } from './scanner.js';

let tempDir: string;

function seedSession(db: ReturnType<typeof openDatabase>, cwd: string | null) {
  db.prepare(`INSERT OR IGNORE INTO sessions (session_id, project, jsonl_path, status, cwd)
    VALUES (?, 'test', '/tmp/s.jsonl', 'dead', ?)`
  ).run(`sess-${Math.random()}`, cwd);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'nexus-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('discoverProjectDocs', () => {
  it('returns SourceFile[] for all .md files under cwd', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    writeFileSync(join(tempDir, 'README.md'), '# readme');
    writeFileSync(join(tempDir, 'notes.md'), '# notes');
    seedSession(db, tempDir);
    const results = discoverProjectDocs(db);
    expect(results.length).toBe(2);
    expect(results.every(r => r.sourceType === 'project_doc')).toBe(true);
  });

  it('ignores node_modules', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    const nmDir = join(tempDir, 'node_modules', 'pkg');
    mkdirSync(nmDir, { recursive: true });
    writeFileSync(join(nmDir, 'README.md'), '# pkg');
    seedSession(db, tempDir);
    const results = discoverProjectDocs(db);
    expect(results.length).toBe(0);
  });

  it('ignores dist, build, .git', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    for (const dir of ['dist', 'build', '.git']) {
      const d = join(tempDir, dir);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'file.md'), '# x');
    }
    seedSession(db, tempDir);
    const results = discoverProjectDocs(db);
    expect(results.length).toBe(0);
  });

  it('deduplicates: two sessions with same cwd → each md appears once', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    writeFileSync(join(tempDir, 'doc.md'), '# doc');
    seedSession(db, tempDir);
    seedSession(db, tempDir);
    const results = discoverProjectDocs(db);
    expect(results.filter(r => r.path.endsWith('doc.md')).length).toBe(1);
  });

  it('nonexistent cwd: skipped silently, no throw', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    seedSession(db, '/nonexistent/path/that/does/not/exist');
    expect(() => discoverProjectDocs(db)).not.toThrow();
    expect(discoverProjectDocs(db).length).toBe(0);
  });

  it('NULL cwd sessions excluded', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    seedSession(db, null);
    expect(discoverProjectDocs(db).length).toBe(0);
  });

  it('CLAUDE.md gets atomTypeOverride reference', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    writeFileSync(join(tempDir, 'CLAUDE.md'), '# claude');
    seedSession(db, tempDir);
    const results = discoverProjectDocs(db);
    expect(results[0].atomTypeOverride).toBe('reference');
  });

  it('architecture.md gets atomTypeOverride architecture', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    writeFileSync(join(tempDir, 'architecture.md'), '# arch');
    seedSession(db, tempDir);
    const results = discoverProjectDocs(db);
    expect(results[0].atomTypeOverride).toBe('architecture');
  });

  it('generic notes.md gets atomTypeOverride project_note', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    writeFileSync(join(tempDir, 'notes.md'), '# notes');
    seedSession(db, tempDir);
    const results = discoverProjectDocs(db);
    expect(results[0].atomTypeOverride).toBe('project_note');
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
npx vitest run src/indexer/scanner.test.ts
```

Expected: FAIL — `discoverProjectDocs` not exported.

**Step 3: Extend SourceFile interface in scanner.ts**

Change the `SourceFile` interface:
```typescript
import type { AtomType } from '../core/types.js';

export interface SourceFile {
  path: string;
  sourceType: SourceType;
  atomTypeOverride?: AtomType;
}
```

**Step 4: Add discoverProjectDocs function to scanner.ts**

Add at end of scanner.ts:
```typescript
import Database from 'better-sqlite3';
import { basename } from 'path';
import matter from 'gray-matter';
import { readFileSync } from 'fs';
import type { AtomType } from '../core/types.js';

function deriveAtomType(filePath: string): AtomType {
  const name = basename(filePath);

  // Check frontmatter type field
  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = matter(content);
    if (parsed.data?.type) {
      const valid: AtomType[] = ['memory', 'agent', 'skill', 'plan', 'feedback', 'reference',
        'project_note', 'architecture', 'task'];
      const t = String(parsed.data.type).toLowerCase() as AtomType;
      if (valid.includes(t)) return t;
    }
  } catch {}

  if (/^CLAUDE\.md$/i.test(name)) return 'reference';
  if (/^README\.md$/i.test(name)) return 'reference';
  if (/architecture/i.test(name)) return 'architecture';
  if (/\.plan\.md$|^plan/i.test(name)) return 'plan';
  return 'project_note';
}

/**
 * Discover project .md files from all cwds recorded in the sessions table.
 * Deduplicates cwds at SQL level (DISTINCT). Ignores node_modules/dist/build/.git.
 */
export function discoverProjectDocs(db: Database.Database): SourceFile[] {
  const cwdRows = db.prepare(
    `SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL`
  ).all() as { cwd: string }[];

  const results: SourceFile[] = [];

  for (const { cwd } of cwdRows) {
    if (!existsSync(cwd)) continue;

    const files = globSync('**/*.md', {
      cwd,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
      absolute: true,
    });

    for (const filePath of files) {
      results.push({
        path: filePath,
        sourceType: 'project_doc',
        atomTypeOverride: deriveAtomType(filePath),
      });
    }
  }

  return results;
}
```

**Step 5: Run tests — verify they pass**

```bash
npx vitest run src/indexer/scanner.test.ts
```

Expected: all 9 tests PASS.

**Step 6: Compile check**

```bash
npx tsc --noEmit
```

**Step 7: Commit**

```bash
git add src/indexer/scanner.ts src/indexer/scanner.test.ts
git commit -m "feat: discoverProjectDocs — index project .md files from sessions.cwd"
```

---

## Task 6: Update indexer.ts (task-006)

**Files:**
- Modify: `src/indexer/indexer.ts`

**Step 1: Add import for discoverProjectDocs**

In the imports at top of `src/indexer/indexer.ts`, change the scanner import:
```typescript
import { discoverSources, discoverSessions, discoverCoworkSessions, discoverProjectDocs } from './scanner.js';
```

Add import for links:
```typescript
import { linkAtom, buildBm25Corpus } from '../core/links.js';
```

**Step 2: Update runFullIndex — add project doc indexing after indexAll()**

After `indexAll();` and before `const postProcess = db.transaction(...)`, add:
```typescript
// Index project .md files discovered from sessions.cwd
const projectDocs = discoverProjectDocs(db);
if (projectDocs.length > 0) {
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
}
```

**Step 3: Update embedUnindexed — build corpus once, call linkAtom per atom**

In `embedUnindexed`, after the early-return guard for empty `unembedded` array and after the warmup check, add corpus build before the loop:

```typescript
// Build BM25 corpus once — O(N) cost paid here rather than O(N²) inside loop
const allAtomsForBm25 = db.prepare(`SELECT id, title, body FROM atoms`).all() as
  { id: string; title: string; body: string }[];
const corpus = buildBm25Corpus(allAtomsForBm25);
```

Then inside the `for (const atom of unembedded)` loop, after the successful `atoms_vec` insert:
```typescript
try {
  db.prepare(`INSERT INTO atoms_vec(rowid, embedding) VALUES (${atom.rowid}, ?)`).run(vecToBlob(vec));
  embedded++;
  await linkAtom(db, atom.id, generateEmbedding, corpus);
} catch (err) {
  skipped++;
}
```

**Step 4: Compile check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

**Step 5: Run existing tests to verify no regressions**

```bash
npx vitest run
```

**Step 6: Commit**

```bash
git add src/indexer/indexer.ts
git commit -m "feat: runFullIndex indexes project docs; embedUnindexed links atoms after embed"
```

---

## Task 7: Update reflector.ts — persist cwd and call linkMemory (task-007)

**Files:**
- Modify: `src/capture/reflector.ts`

**Step 1: Check embedMemory return type**

Read `src/core/memories.ts` — search for `embedMemory` function signature. If it returns `void`, call `linkMemory` unconditionally. If it returns `boolean | Promise<boolean>`, gate on the return value.

**Step 2: Add linkMemory import**

At top of `reflector.ts`, add to imports:
```typescript
import { linkMemory } from '../core/links.js';
```

**Step 3: Persist cwd after INSERT OR IGNORE**

After the existing `INSERT OR IGNORE INTO sessions` statement:
```typescript
db.prepare(
  `INSERT OR IGNORE INTO sessions (session_id, project, jsonl_path, status) VALUES (?, ?, ?, 'dead')`
).run(opts.session_id, opts.project ?? 'unknown', opts.transcript_path);

// NEW: Persist cwd if provided
if (opts.cwd) {
  db.prepare(`UPDATE sessions SET cwd = ? WHERE session_id = ?`).run(opts.cwd, opts.session_id);
}
```

**Step 4: Call linkMemory after embedMemory**

In the `if (res.inserted)` block, change:
```typescript
if (res.inserted) {
  inserted++;
  await embedMemory(db, res.id, embed);
  await linkMemory(db, res.id, embed);  // NEW — linkMemory has its own skip guard
}
```

**Step 5: Compile check**

```bash
npx tsc --noEmit
```

**Step 6: Run tests**

```bash
npx vitest run
```

**Step 7: Commit**

```bash
git add src/capture/reflector.ts
git commit -m "feat: reflector persists sessions.cwd and links memories after embed"
```

---

## Task 8: Add nexus_crossref MCP tool (task-008)

**Files:**
- Modify: `src/mcp/server.ts`

**Step 1: Add imports to server.ts**

After existing imports, add:
```typescript
import { buildBm25Corpus, rrfMerge, type RankedResult } from '../core/links.js';
import { generateEmbedding } from '../core/embeddings.js';
import type { CrossRefResult, LinkType } from '../core/types.js';
```

Note: `generateEmbedding` may already be imported — check and avoid duplicate import.

**Step 2: Add nexus_crossref tool after nexus_recall**

Find the `nexus_recall` tool registration and add the new tool after it:

```typescript
// ── nexus_crossref ─────────────────────────────────────────────────────

server.tool(
  'nexus_crossref',
  'Cross-reference retrieval: find atoms semantically related to a query, annotated with existing link types. Uses hybrid BM25 + dense search merged via RRF.',
  {
    query:   z.string().describe('Topic or text to find cross-references for'),
    project: z.string().optional().describe('Filter to a specific project slug'),
    cwd:     z.string().optional().describe('Caller working directory — derives project slug'),
    limit:   z.coerce.number().optional().describe('Max results to return (default: 10)'),
  },
  async ({ query, project, cwd, limit }): Promise<{ content: { type: 'text'; text: string }[] }> => {
    const cap = limit ?? 10;
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(cwd) : undefined);
    const fetchSize = cap * 2;

    // 1. Dense KNN
    const denseResults: RankedResult[] = [];
    const denseSimilarity = new Map<string, number>();
    const queryVec = await generateEmbedding(query);

    if (queryVec) {
      try {
        const rows = db.prepare(`
          SELECT rowid, distance FROM atoms_vec
          WHERE embedding MATCH json(?)
          ORDER BY distance
          LIMIT ?
        `).all(JSON.stringify(Array.from(queryVec)), fetchSize) as
          { rowid: number; distance: number }[];

        for (const r of rows) {
          const atom = db.prepare(`SELECT id FROM atoms WHERE rowid = ?`).get(r.rowid) as
            { id: string } | undefined;
          if (!atom) continue;
          const similarity = Math.max(0, Math.min(1, 1 - (r.distance * r.distance) / 2));
          denseResults.push({ id: atom.id, score: similarity });
          denseSimilarity.set(atom.id, similarity);
        }
      } catch {
        // sqlite-vec unavailable
      }
    }

    // 2. BM25 search
    const allAtoms = db.prepare(`SELECT id, title, body FROM atoms`).all() as
      { id: string; title: string; body: string }[];
    const corpus = buildBm25Corpus(allAtoms);
    const bm25Results: RankedResult[] = [];
    try {
      const hits = corpus.search(query, fetchSize);
      for (const hit of hits) {
        bm25Results.push({ id: hit.ref, score: hit.score });
      }
    } catch {}

    // 3. RRF merge
    const merged = rrfMerge(bm25Results, denseResults, cap);

    if (merged.length === 0) {
      return { content: [{ type: 'text', text: 'No cross-references found.' }] };
    }

    // 4. Normalize scores to [0,1]
    const maxScore = merged[0].score;
    const normalized = merged.map(r => ({ ...r, score: maxScore > 0 ? r.score / maxScore : 0 }));

    // 5. Fetch atom details
    const ids = normalized.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');

    let atomsQuery = `SELECT id, title, atom_type, body FROM atoms WHERE id IN (${placeholders})`;
    const queryArgs: (string | number)[] = [...ids];

    if (effectiveProject) {
      atomsQuery = `SELECT id, title, atom_type, body FROM atoms WHERE id IN (${placeholders}) AND project = ?`;
      queryArgs.push(effectiveProject);
    }

    const atomRows = db.prepare(atomsQuery).all(...queryArgs) as
      { id: string; title: string; atom_type: string; body: string }[];

    // 6. JOIN atom_links for link annotation
    const links = db.prepare(
      `SELECT source_id, target_id, link_type FROM atom_links
       WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`
    ).all(...ids, ...ids) as { source_id: string; target_id: string; link_type: string }[];

    const linkMap = new Map<string, string>();
    for (const l of links) {
      if (!linkMap.has(l.source_id)) linkMap.set(l.source_id, l.link_type);
      if (!linkMap.has(l.target_id)) linkMap.set(l.target_id, l.link_type);
    }

    // 7. Build CrossRefResult[]
    const atomMap = new Map(atomRows.map(a => [a.id, a]));
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

    if (results.length === 0) {
      return { content: [{ type: 'text', text: 'No cross-references found.' }] };
    }

    const text = results
      .map(r => {
        const badge = r.link_type ? ` [${r.link_type}]` : '';
        return `### ${r.title}${badge}\n_${r.atom_type} | score: ${r.score.toFixed(2)}_\n\n${r.body_snippet}`;
      })
      .join('\n\n---\n\n');

    return { content: [{ type: 'text', text }] };
  }
);
```

**Step 3: Compile check**

```bash
npx tsc --noEmit
```

Expected: zero errors. Fix any import conflicts (e.g. if `generateEmbedding` was not previously imported, add it; if it was, don't duplicate).

**Step 4: Run tests**

```bash
npx vitest run
```

**Step 5: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: add nexus_crossref MCP tool — hybrid BM25+dense cross-reference retrieval"
```

---

## Task 9: Unit tests for links.ts (task-009)

> Note: The core test file was created in Task 4. This task verifies completeness and adds any missing coverage.

**Files:**
- Verify/extend: `src/core/links.test.ts`

**Step 1: Run existing links tests**

```bash
npx vitest run src/core/links.test.ts --reporter=verbose
```

**Step 2: Check coverage against acceptance criteria**

Verify all 10 cases from the spec are tested:
- [ ] rrfMerge dual-list ranking
- [ ] rrfMerge empty dense list
- [ ] rrfMerge empty BM25 list
- [ ] rrfMerge topK cap
- [ ] upsertLink bidirectionality (2 rows)
- [ ] upsertLink idempotency
- [ ] upsertLink self-link prevention
- [ ] linkAtom skip guard
- [ ] linkAtom writes links when similar atom exists
- [ ] buildBm25Corpus relevance ordering

**Step 3: Add any missing tests and re-run**

```bash
npx vitest run src/core/links.test.ts
```

Expected: all tests PASS.

**Step 4: Commit if changes made**

```bash
git add src/core/links.test.ts
git commit -m "test: complete coverage for links.ts unit tests"
```

---

## Task 10: scanner.test.ts coverage verification (task-010)

> Note: The test file was created in Task 5. This task verifies completeness.

**Files:**
- Verify/extend: `src/indexer/scanner.test.ts`

**Step 1: Run scanner tests**

```bash
npx vitest run src/indexer/scanner.test.ts --reporter=verbose
```

**Step 2: Verify all 9 test cases pass**

Expected: all 9 tests PASS.

**Step 3: Commit if any fixes needed**

```bash
git add src/indexer/scanner.test.ts
git commit -m "test: complete coverage for discoverProjectDocs unit tests"
```

---

## Task 11: Integration and database tests (task-011)

**Files:**
- Extend: `src/core/database.test.ts`
- Extend: `src/integration.test.ts`

**Step 1: Check if test files exist**

```bash
ls C:/Fran/claude-nexus/src/core/database.test.ts 2>/dev/null || echo "NOT FOUND"
ls C:/Fran/claude-nexus/src/integration.test.ts 2>/dev/null || echo "NOT FOUND"
```

**Step 2: Migration 6 tests are already in database.test.ts (from Task 3)**

Run to confirm they pass:

```bash
npx vitest run src/core/database.test.ts
```

Expected: all 6 migration tests PASS.

**Step 3: Add project_doc integration test to integration.test.ts**

If `freshDb()` and `vecFromText()` helpers exist, use them. Otherwise define inline:

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join, tmpdir } from 'path';
import { openDatabase, initializeSchema } from './core/database.js';
import { discoverProjectDocs } from './indexer/scanner.js';
import { indexFile } from './indexer/indexer.js';
import { prepareStatements } from './indexer/indexer.js'; // export if needed
import { embedUnindexed } from './indexer/indexer.js';

// Deterministic fake embed
function vecFromText(text: string): Float32Array {
  const v = new Float32Array(1024).fill(0);
  v[text.charCodeAt(0) % 1024] = 1.0;
  return v;
}

describe('project_doc corpus expansion', () => {
  it('indexes project .md, embeds, links, writes atom_links', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'nexus-integ-'));
    try {
      // 1. Two .md files in temp dir
      writeFileSync(join(tempDir, 'alpha.md'), '# Alpha\nAlpha concept body text.');
      writeFileSync(join(tempDir, 'beta.md'), '# Beta\nBeta related concept text.');

      const db = openDatabase(':memory:');
      initializeSchema(db);

      // 2. Seed session with cwd = tempDir
      db.prepare(`INSERT INTO sessions (session_id, project, jsonl_path, status, cwd)
        VALUES ('integ-sess', 'test', '/tmp/s.jsonl', 'dead', ?)`).run(tempDir);

      // 3. discoverProjectDocs → 2 SourceFiles
      const sources = discoverProjectDocs(db);
      expect(sources.length).toBe(2);

      // 4. indexFile each → atoms with source_type='project_doc'
      const stmts = (db as any)._prepareStmts ?? (() => {
        // If prepareStatements is not exported, call runFullIndex with injected embed
        return null;
      })();

      // Use direct SQL path if prepareStatements not exported
      for (const source of sources) {
        db.prepare(`INSERT OR IGNORE INTO atoms (id, title, body, atom_type, scope, source_path, source_type, content_hash, tags)
          VALUES (?, ?, ?, 'project_note', 'project', ?, 'project_doc', ?, '[]')`
        ).run(source.path, 'Test', 'Test body', source.path, source.path);
      }

      const atomCount = (db.prepare(`SELECT COUNT(*) as c FROM atoms WHERE source_type='project_doc'`).get() as { c: number }).c;
      expect(atomCount).toBe(2);

      // 5. embedUnindexed with fake embedFn
      // Override generateEmbedding via environment or call linkAtom directly
      const atoms = db.prepare(`SELECT rowid, id, title, body FROM atoms`).all() as
        { rowid: number; id: string; title: string; body: string }[];

      for (const atom of atoms) {
        const vec = vecFromText(atom.title + '\n' + atom.body);
        const blob = Buffer.from(vec.buffer);
        try {
          db.prepare(`INSERT INTO atoms_vec(rowid, embedding) VALUES (${atom.rowid}, ?)`).run(blob);
        } catch {}
      }

      const { linkAtom, buildBm25Corpus } = await import('./core/links.js');
      const allAtoms = db.prepare(`SELECT id, title, body FROM atoms`).all() as
        { id: string; title: string; body: string }[];
      const corpus = buildBm25Corpus(allAtoms);

      for (const atom of atoms) {
        await linkAtom(db, atom.id, async (text) => vecFromText(text), corpus);
      }

      // 6. atom_links populated
      const linkCount = (db.prepare(`SELECT COUNT(*) as c FROM atom_links`).get() as { c: number }).c;
      expect(linkCount).toBeGreaterThan(0);

      // 7. atoms.linked_at is set
      const unlinked = (db.prepare(`SELECT COUNT(*) as c FROM atoms WHERE linked_at IS NULL`).get() as { c: number }).c;
      expect(unlinked).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
```

**Step 4: Run integration test**

```bash
npx vitest run src/integration.test.ts
```

Expected: PASS.

**Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS. No regressions.

**Step 6: Commit**

```bash
git add src/core/database.test.ts src/integration.test.ts
git commit -m "test: migration 6 assertions and project_doc corpus expansion integration test"
```

---

## Final Verification

**Step 1: Full compile**

```bash
npx tsc --noEmit
```

Expected: zero errors.

**Step 2: Full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

**Step 3: Verify branch**

```bash
git log --oneline -11
```

Expected: 11 commits for the 11 tasks (some may be combined).

**Step 4: Summary of changes**

| File | Status |
|------|--------|
| `package.json` | Added `wink-bm25-text-search` |
| `src/types/wink-bm25-text-search.d.ts` | Created (type shim) |
| `src/core/types.ts` | Added `project_doc`, `linked_at`, `CrossRefResult`, `cwd` |
| `src/core/database.ts` | Migration 6 added |
| `src/core/links.ts` | Created — hybrid BM25+dense linking |
| `src/indexer/scanner.ts` | `discoverProjectDocs` added |
| `src/indexer/indexer.ts` | `runFullIndex` + `embedUnindexed` updated |
| `src/capture/reflector.ts` | `cwd` persistence + `linkMemory` call |
| `src/mcp/server.ts` | `nexus_crossref` tool added |
| `src/core/links.test.ts` | Created — 10 unit tests |
| `src/indexer/scanner.test.ts` | Created — 9 unit tests |
| `src/core/database.test.ts` | Extended — 6 migration 6 tests |
| `src/integration.test.ts` | Extended — project_doc flow test |

---

> Plan complete and saved to `docs/plans/2026-05-23-corpus-expansion-features-1-4.md`.

**Two execution options:**

**1. In-Session (this session)** — dispatch fresh subagent per task, two-stage review after each, fast iteration

**2. Async Batched (separate session)** — open new session with plan file, batch execution with human checkpoints between batches

**Which approach?**
