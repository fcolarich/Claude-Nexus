# Claude Nexus — Corpus Expansion + Auto-Linking Spec

**Project:** `C:\Fran\claude-nexus`  
**Status:** Ready to implement. Prereqs: node, better-sqlite3, sqlite-vec, mxbai-embed-large via Ollama.

---

## Context

Claude Nexus is the cross-session memory engine for Claude Code. It has two storage types:

| Type | Table | What it is |
|------|-------|------------|
| **Atoms** | `atoms` + `atoms_vec` | File-mirrored structured content. Source of truth is the file. |
| **Memories** | `memories` + `memories_vec` | Autonomous distilled facts from session transcripts. Confidence/decay lifecycle. |

Cross-references live in `atom_links` (link_type: `references \| extends \| refines \| contradicts \| supports \| duplicates \| related`) and `memory_links`. Neither is populated automatically yet — that's what this spec builds.

**Goal:** Single corpus. Every `.md` file across all Claude Code projects indexed as atoms. Every new atom or memory auto-linked to related entries via hybrid BM25 + dense + RRF (same approach as the Zettelkasten RAG pass in `C:\Fran\LLM_Workflow_Optimization\Ebook Zettelkasten Subproject\epub_zettelkasten\rag\`).

---

## What Was Already Done (this session)

These changes are already committed in the repo:

- **`src/capture/extract.ts`** — system prompt: added `scope: global` examples, contradiction→`correction` guidance, filter for memory-index content leaking as memories
- **`src/indexer/indexer.ts`** — `cwdToProjectSlug` returns `string | null` for slugs < 3 chars (prevents project `p` junk)
- **`src/capture/load-runner.ts`** — same null guard
- **`src/mcp/server.ts`** — `resolveProjectFromCwd` handles nullable slug
- **`src/slug.test.ts`** — test for degenerate slug → null

---

## Feature 1 — cwd Persistence in Sessions Table

**Problem:** Nexus knows project slugs (`C--Fran-LLM-Workflow-Optimization`) but not the actual filesystem path. The slug→path mapping is needed to scan project directories for `.md` files. The `cwd` is passed to the runner but discarded after slug derivation.

### Changes

**`src/core/database.ts`** — add column to schema:
```sql
ALTER TABLE sessions ADD COLUMN cwd TEXT;
```
Add to the `CREATE TABLE sessions` statement so new DBs include it. For existing DBs, the migration runs at startup via `initializeSchema` (which already uses `CREATE TABLE IF NOT EXISTS` — add the column with a conditional `ALTER TABLE` if missing).

**`src/capture/runner.ts`** — persist cwd:
```ts
// In the INSERT OR IGNORE that creates the session row, add cwd:
db.prepare(
  `INSERT OR IGNORE INTO sessions (session_id, project, jsonl_path, cwd, status)
   VALUES (?, ?, ?, ?, 'dead')`
).run(opts.session_id, opts.project ?? 'unknown', opts.transcript_path, opts.cwd ?? null);

// Also UPDATE cwd if the row already exists (backfill):
db.prepare(
  `UPDATE sessions SET cwd = ? WHERE session_id = ? AND cwd IS NULL`
).run(opts.cwd ?? null, opts.session_id);
```

**`src/capture/reflector.ts`** — `ReflectOptions` already has `cwd?: string`. Pass it through to the DB ops above.

### Result

After one session fires per project, `sessions.cwd` has the real path. Query for all known project paths:
```sql
SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL AND cwd != ''
```

---

## Feature 2 — Project `.md` File Scanning

**Problem:** The scanner only looks at `~/.claude/` subdirectories. Project documents, architecture decisions, tool analysis, research notes — all ignored.

### New function in `src/indexer/scanner.ts`

```ts
/**
 * Discover project .md files from all known project cwds.
 * Called after discoverSources() in the main index run.
 */
export function discoverProjectDocs(db: Database.Database): SourceFile[] {
  const rows = db.prepare(
    `SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL AND cwd != ''`
  ).all() as { cwd: string }[];

  const sources: SourceFile[] = [];
  const IGNORE = /[/\\](node_modules|dist|build|\.git|\.next|out|coverage|__pycache__|\.venv)[/\\]/;

  for (const { cwd } of rows) {
    if (!existsSync(cwd)) continue;
    const files = globSync('**/*.md', { cwd, absolute: true, nodir: true });
    for (const f of files) {
      if (!IGNORE.test(f)) {
        sources.push({ path: f, sourceType: 'project_doc' });
      }
    }
  }
  return sources;
}
```

**`src/core/types.ts`** — add to SourceType:
```ts
export type SourceType = 'memory_file' | 'agent_def' | 'skill_def' | 'plan_file' | 'nexus_native' | 'project_doc';
```

**`src/indexer/indexer.ts`** — call `discoverProjectDocs` in the main index run alongside `discoverSources()`.

### atom_type derivation for project docs

When parsing a project `.md` file, derive `atom_type` from frontmatter or filename:

| Signal | atom_type |
|--------|-----------|
| filename contains `architecture`, `design`, `adr` | `architecture` |
| filename contains `index`, `readme`, `claude` | `reference` |
| frontmatter `type: decision` | `decision` (use existing) |
| default | `project_note` |

The existing parser (`src/indexer/parser.ts`) already splits `.md` files into section atoms by heading. No changes needed there.

### Incremental indexing

The indexer already tracks `content_hash` on atoms and skips re-indexing unchanged files. Project docs get the same treatment — only new or changed files hit the parser and embedder.

---

## Feature 3 — Auto-Linking on Write (Hybrid BM25 + Dense + RRF)

**Modeled on:** `Ebook Zettelkasten Subproject/epub_zettelkasten/rag/indexer.py`  
`MilvusVaultIndex.query()` → dense (Ollama embed) + BM25Okapi + RRF merge (K=60)

Nexus already has the dense side (sqlite-vec + mxbai-embed-large). Add BM25 + RRF.

### New file: `src/core/links.ts`

```ts
/**
 * Auto-linking — runs after a new atom or memory is embedded.
 * Searches atoms_vec + memories_vec (dense) and a BM25 corpus (sparse),
 * merges with RRF, writes atom_links rows.
 *
 * Link types:
 *   similarity >= 0.86 → 'duplicates'
 *   similarity 0.70–0.86 → 'related'
 *
 * 'contradicts' / 'supports' / 'extends' require LLM classification —
 * handled by a separate distill-style command, not here.
 */

const RELATED_LOW  = 0.70;
const RELATED_HIGH = 0.86;  // at/above → duplicates
const RRF_K = 60;
const TOP_K = 12;           // candidates per retrieval before RRF

export async function linkAtom(db: Database.Database, atomId: string): Promise<void> { ... }
export async function linkMemory(db: Database.Database, memoryId: string): Promise<void> { ... }
```

### BM25 corpus

Use `wink-bm25-text-search` (pure JS, no native deps). Build in-memory from all non-superseded atoms + memories at link time. For large corpora this is fast enough (< 50ms for 5000 docs).

```ts
import BM25 from 'wink-bm25-text-search';
// or alternatively: build a simple TF-IDF if wink-bm25 has issues
```

Alternative: `tiny-bm25` or `@stdlib/stats`. Pick whichever has zero native dependencies and works in Node 20.

### RRF merge

```ts
function rrfMerge(
  dense: Array<{ id: string; similarity: number }>,
  sparse: Array<{ id: string; score: number }>,
  k: number = 5
): Array<{ id: string; score: number }> {
  const scores: Map<string, number> = new Map();
  dense.forEach(({ id }, rank) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
  });
  sparse.forEach(({ id }, rank) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
  });
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
```

### Link insertion

```ts
function upsertLink(
  db: Database.Database,
  sourceId: string,
  targetId: string,
  linkType: LinkType,
  confidence: number
): void {
  db.prepare(`
    INSERT OR REPLACE INTO atom_links (source_id, target_id, link_type, confidence)
    VALUES (?, ?, ?, ?)
  `).run(sourceId, targetId, linkType, confidence);
  // bidirectional
  db.prepare(`
    INSERT OR REPLACE INTO atom_links (source_id, target_id, link_type, confidence)
    VALUES (?, ?, ?, ?)
  `).run(targetId, sourceId, linkType, confidence);
}
```

### Call sites

**`src/indexer/indexer.ts`** — after `embedAtom()` succeeds:
```ts
await embedAtom(db, atom.id, embedFn);
await linkAtom(db, atom.id);   // ← add this
```

**`src/capture/reflector.ts`** — after `embedMemory()` succeeds:
```ts
await embedMemory(db, res.id, embed);
await linkMemory(db, res.id);  // ← add this
```

`linkMemory` searches both `atoms_vec` and `memories_vec`. Links go into `atom_links` (atom↔atom, atom↔memory). The table is already schema'd for cross-type links — `source_id` and `target_id` are just strings.

---

## Feature 4 — New MCP Tools

Add to `src/mcp/server.ts`:

### `nexus_crossref`

Given a query string, return all atoms + memories related to it with link types.

```
Input:  { query: string, project?: string, limit?: number }
Output: list of { id, title, type, link_type, score, body_snippet }
```

Implementation: same hybrid BM25 + dense + RRF as `linkAtom` — reuse the corpus build and `rrfMerge` from `src/core/links.ts`. Steps:

1. Embed query → KNN against `atoms_vec` + `memories_vec` (TOP_K candidates each)
2. BM25 score query tokens against the in-memory corpus
3. RRF merge (K=60) → top `limit` results
4. For each result, join `atom_links` to find link types from/to that item
5. Return ranked list with link_type annotation

Do NOT use embedding-only search. The query may be keyword-heavy with no close vector neighbors — BM25 leg is essential here.

### `nexus_analyze` (Phase 2 — design separately)

Run a full corpus pass:
- Find all `duplicates` links → surface as warnings
- Cluster atoms with no inbound `supports`/`extends`/`references` links → potential blind spots
- Find atom pairs where one body contains negating language about the same entity as another → candidate `contradicts` links (send to LLM for confirmation)

---

## File Change Summary

| File | Change |
|------|--------|
| `src/core/database.ts` | Add `cwd TEXT` to sessions schema + migration guard |
| `src/core/types.ts` | Add `'project_doc'` to SourceType |
| `src/capture/runner.ts` | Persist `cwd` in session row |
| `src/capture/reflector.ts` | Call `linkMemory()` after embed |
| `src/indexer/scanner.ts` | Add `discoverProjectDocs(db)` |
| `src/indexer/indexer.ts` | Call `discoverProjectDocs`, call `linkAtom()` after embed |
| `src/core/links.ts` | **New file** — `linkAtom`, `linkMemory`, `rrfMerge`, BM25 corpus, `upsertLink` |
| `src/mcp/server.ts` | Add `nexus_crossref` tool |
| `package.json` | Add BM25 package (e.g. `wink-bm25-text-search`) |

Estimated: ~250 lines of new code, changes to 7 existing files.

---

## Constraints / Decisions

- **Do not** use Milvus for Nexus. Nexus uses sqlite-vec (already working). Milvus is only for the Zettelkasten.
- **Do not** add a `project_roots` config. Project paths self-discover from `sessions.cwd` — zero config.
- **Do not** link atoms to themselves. Filter `sourceId === targetId` before inserting.
- **Do not** re-link on every index run. Track a `linked_at` timestamp on atoms; skip if `linked_at > updated_at`.
- BM25 corpus is built in-memory at link time, not persisted. Fast enough for < 10k docs; revisit if corpus grows.
- Link threshold `RELATED_LOW = 0.70` matches `distill.ts` `BAND_LOW`. Keep them in sync.
- `contradicts` / `supports` link types are LLM-only — never assign them from embedding similarity alone.
- The existing `distill.ts` already handles memory→memory dedup via LLM. Don't duplicate that logic in `links.ts`. `links.ts` is embedding-only, fast-path.
- **Phase 2 dependency:** Once `atom_links` is populated by Feature 3, `src/core/recall.ts` should import `rrfMerge` from `links.ts` and add a hybrid recall path (vector + BM25 + graph traversal). Specified in `Claude Nexus - Phase 2 Gaps Spec.md` Gap 1–2. Do not implement here — recall changes require atom_links to be populated first.

---

## Test Coverage Needed

- `src/core/links.test.ts` — unit tests for `rrfMerge`, `upsertLink` (bidirectionality, dedup)
- `src/indexer/scanner.test.ts` — `discoverProjectDocs` with mock DB + temp dirs; ignore pattern coverage
- Add to `src/integration.test.ts` — full flow: index a project_doc → embed → link → verify atom_links populated

---

## Reference

Zettelkasten RAG for comparison:
- `Ebook Zettelkasten Subproject/epub_zettelkasten/rag/indexer.py` — `MilvusVaultIndex.query()`: dense + BM25 + RRF
- `Ebook Zettelkasten Subproject/epub_zettelkasten/rag/related.py` — `populate_related()`: the write pass

Nexus existing infrastructure to reuse:
- `src/core/memories.ts` → `findSimilarMemory()` — dense search against memories_vec
- `src/core/embeddings.ts` → `generateEmbedding()` — mxbai-embed-large via Ollama
- `src/core/distill.ts` → `relatedMemories()` — band-based similarity search pattern to mirror
- `src/core/database.ts` → `initializeSchema()` — add cwd column + migration guard here
