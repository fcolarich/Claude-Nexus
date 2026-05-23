# Design — Claude Nexus Corpus Expansion (Features 1–4)

## Problem

Claude Nexus captures session memories and indexes Claude config files (agents, skills, plans, memory .md files). It does NOT:

1. Record which filesystem directory a session ran in (`cwd` missing from the `sessions` table).
2. Index `.md` files from the *projects* users are actually working on — only Claude's own config .mds are indexed.
3. Automatically link newly written atoms/memories to semantically related existing content (links are inferred by keyword overlap only, no vector similarity).
4. Expose cross-reference retrieval to MCP callers — there is no tool to ask "what is linked to X?".

These gaps leave the knowledge graph sparse and make recall incomplete for LLM consumers.

---

## Goals

- **G1** — `sessions.cwd` persisted on every session row so the indexer can locate project roots.
- **G2** — `discoverProjectDocs(db)` discovers `**/*.md` files in every cwd recorded in sessions (ignoring `node_modules`, `dist`, `build`, `.git`), indexes them as `source_type = 'project_doc'` atoms.
- **G3** — After embed, `linkAtom` / `linkMemory` run a hybrid BM25 + dense search with RRF merge, writing bidirectional `atom_links` / `memory_links` rows using similarity-derived link types (`duplicates` ≥ 0.86, `related` 0.70–0.86). `contradicts` / `supports` / `extends` remain LLM-only and are out of scope.
- **G4** — New MCP tool `nexus_crossref` returns link-annotated cross-references for a query, reusing the hybrid retrieval from G3.
- **G5** — Linking is incremental: `linked_at` timestamp on atoms skips re-link when `linked_at > updated_at`.
- **G6** — BM25 corpus is built in-memory per link call — never persisted.
- **G7** — Full test coverage: unit tests for `rrfMerge` / `upsertLink`, `discoverProjectDocs` with mock DB + tmp dirs, and an integration test covering index → embed → link → verify `atom_links` populated.

---

## Non-Goals

- Phase 2 items: Gap 1 (hybrid recall pipeline), Gap 2 (graph traversal), Gap 3 (contradiction flag), Gap 4 (secrets filter) — explicitly out of scope.
- LLM-assigned link types (`contradicts`, `supports`, `extends`) — not part of this feature set.
- Persisted BM25 index — in-memory only.
- `project_roots` config table — paths discovered solely from `sessions.cwd`.
- Self-links (atom linked to itself).
- Milvus or any external vector store — sqlite-vec only.

---

## Constraints

- **Tech stack locked**: TypeScript, `better-sqlite3`, `sqlite-vec`, existing migration framework in `database.ts`.
- **Zero native deps for BM25**: use `wink-bm25-text-search` (pure JS). No native addons.
- **Scope cap**: Features 1–4 only. No Phase 2 work.
- **Schema changes via migration framework**: new migration version 6 for `sessions.cwd` + `atoms.linked_at`. Guarded `ALTER TABLE` pattern matches existing migrations 3/4.
- **Bidirectional links**: every `upsertLink(a, b)` call inserts both (a→b) and (b→a) rows.
- **No re-link on every run**: `linkAtom` / `linkMemory` skip items where `linked_at > updated_at`.

---

## Proposed Approach

**Incremental hybrid linking with in-memory BM25 and sqlite-vec dense search, merged via RRF.**

Selected over two alternatives:

| Approach | Advantage | Trade-off |
|----------|-----------|-----------|
| **Hybrid BM25 + dense + RRF (selected)** | Catches both keyword-exact and semantic near-matches; RRF rank fusion is cheap and well-understood | BM25 corpus rebuilt per call — acceptable at current corpus sizes (< 50 k atoms) |
| Dense-only (cosine threshold) | Simpler; already have `findSimilarMemory` as a pattern | Misses keyword-identical atoms with low cosine (e.g. short config snippets) |
| FTS5-only (keyword) | Already exists in atoms_fts; zero new deps | No semantic similarity; misses paraphrases |

### Feature breakdown

**F1 — cwd Persistence**

Migration 6 adds `cwd TEXT` to `sessions` via guarded `ALTER TABLE` (existing pattern from migration 3). `runner.ts` already receives `cwd` as argv[2] and passes it to `reflect()`; it must also write it to the session row via `INSERT OR IGNORE` + `UPDATE` backfill. The `reflector.ts` `ReflectOptions` already has `cwd?: string` — no interface change needed.

**F2 — Project .md Scanning**

`discoverProjectDocs(db: Database.Database): SourceFile[]` in `scanner.ts`:
- Query `SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL`
- For each cwd, `globSync('**/*.md', { cwd, ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'], absolute: true })`
- Return `{ path, sourceType: 'project_doc' }`
- Add `'project_doc'` to the `SourceType` union in `types.ts` AND to the `source_type CHECK` constraint in the atoms table (migration 6 recreates the table's CHECK if needed, using the existing `migrateTaskSupport` pattern)

`atom_type` derivation from filename / frontmatter:
- Frontmatter `type:` field if present (normalized to valid AtomType)
- Filename patterns: `CLAUDE.md`, `README.md` → `reference`; `architecture*.md` → `architecture`; `*.plan.md` / `plan*.md` → `plan`; default → `project_note`

`indexer.ts` `runFullIndex()`: call `discoverProjectDocs(db)` alongside `discoverSources()`, feed results into the same `indexFile()` loop.

**F3 — Auto-Linking**

New file `src/core/links.ts`:

```
rrfMerge(bm25Results, denseResults, K=60) → merged ranked list (TOP_K=12)
buildBm25Corpus(atoms) → BM25Index (wink-bm25-text-search)
linkAtom(db, atomId, embedFn) → void
linkMemory(db, memoryId, embedFn) → void
upsertLink(db, sourceId, targetId, linkType, confidence, table) → void  // bidirectional
```

Similarity → link type mapping:
- `similarity >= 0.86` → `duplicates`
- `0.70 <= similarity < 0.86` → `related`

`linked_at` column added to `atoms` (migration 6, guarded ALTER). Skip re-link when `linked_at > updated_at`.

Call sites:
- `indexer.ts` `embedUnindexed()`: after successful `db.prepare INSERT INTO atoms_vec`, call `await linkAtom(db, atom.id)`
- `reflector.ts` `reflect()`: after `await embedMemory(db, res.id, embed)` succeeds, call `await linkMemory(db, res.id, embed)`

**F4 — nexus_crossref MCP Tool**

In `server.ts`:
```typescript
server.tool('nexus_crossref', ..., { query, project?, limit? }, async ({ query, project, limit }) => {
  // 1. generateEmbedding(query) → queryVec
  // 2. dense KNN over atoms_vec (TOP_K=12)
  // 3. BM25 search over in-memory corpus (TOP_K=12)
  // 4. rrfMerge → top `limit` (default 10) results
  // 5. JOIN atom_links to annotate link_type per result
  // 6. Return { id, title, type, link_type, score, body_snippet }[]
})
```

Reuses `rrfMerge` and BM25 logic exported from `links.ts`. Does NOT persist a corpus — builds in-memory per call.

---

## Key Questions for Architect

1. **CHECK constraint on `source_type`**: The `atoms` table has `source_type TEXT NOT NULL CHECK(source_type IN (...))`. Adding `'project_doc'` requires either recreating the table (like `migrateTaskSupport` does) or dropping the constraint. Which pattern to use for migration 6 — full table recreate or constraint drop-and-recreate? (Recreate is safer but heavier; inspect whether SQLite supports inline constraint modification.)

2. **`linked_at` column placement**: Should `linked_at` live on `atoms` only, or also on `memories`? The spec says "Track `linked_at` on atoms" but `linkMemory` is symmetric — confirm whether `memories.linked_at` is required too.

3. **BM25 corpus scope**: `linkAtom` builds its BM25 corpus from all atoms at call time. For large corpora this is O(N) per link operation. At what atom count should we switch to a pre-built per-run corpus passed in? Design the `links.ts` API to accept an optional pre-built corpus to avoid future refactor.

4. **`discoverProjectDocs` dedup**: If two sessions share the same `cwd`, the same .md files will appear twice in the SourceFile list. `indexFile` is idempotent (upsert by id = `computeAtomId(path, section_index)`) but the glob will run twice — add a `Set<string>` dedup inside `discoverProjectDocs` or deduplicate cwds before globbing.

5. **`nexus_crossref` link annotation**: The JOIN against `atom_links` returns the link type for already-linked results. For freshly-searched results with no link row, should `link_type` be `null` or omitted from the output? Clarify the output contract for unlinked hits.

---

## Success Criteria

- **SC1** — `sessions` table has a `cwd` column; running the reflector with a cwd argument results in that cwd stored in the session row.
- **SC2** — After `runFullIndex()` on a project with .md files in its cwd, those files appear in `atoms` with `source_type = 'project_doc'`.
- **SC3** — After indexing and embedding a `project_doc` atom, `atom_links` contains at least one row with that atom as `source_id` or `target_id` (when a related atom exists).
- **SC4** — `upsertLink` inserts rows in both (A→B) and (B→A) directions; duplicate calls are idempotent.
- **SC5** — `rrfMerge` correctly ranks a result that appears in both BM25 and dense lists above one that appears in only one list.
- **SC6** — `linkAtom` does not insert a self-link (source_id == target_id).
- **SC7** — `linkAtom` skips an atom whose `linked_at > updated_at`.
- **SC8** — `nexus_crossref` MCP tool returns results with `link_type` annotation populated where a link row exists.
- **SC9** — `discoverProjectDocs` ignores `node_modules`, `dist`, `build`, `.git` paths; covered by unit tests with temp dirs.
- **SC10** — Integration test: index a temp .md file as `project_doc` → embed → link → verify `atom_links` rows exist.

---

## Files Changed

| File | Change |
|------|--------|
| `src/core/database.ts` | Migration 6: `sessions.cwd TEXT`, `atoms.linked_at TEXT`, extend `source_type` CHECK |
| `src/core/types.ts` | Add `'project_doc'` to `SourceType`; add `linked_at?: string` to `Atom` |
| `src/core/links.ts` | **New** — `rrfMerge`, `buildBm25Corpus`, `linkAtom`, `linkMemory`, `upsertLink` |
| `src/capture/runner.ts` | Persist `cwd` on session row after INSERT OR IGNORE |
| `src/capture/reflector.ts` | Call `linkMemory()` after successful `embedMemory()` |
| `src/indexer/scanner.ts` | Add `discoverProjectDocs(db)` |
| `src/indexer/indexer.ts` | Call `discoverProjectDocs(db)` in `runFullIndex`; call `linkAtom()` after embed in `embedUnindexed()` |
| `src/mcp/server.ts` | Add `nexus_crossref` tool |
| `package.json` | Add `wink-bm25-text-search` dependency |
| `src/core/links.test.ts` | **New** — unit tests for `rrfMerge`, `upsertLink` |
| `src/indexer/scanner.test.ts` | `discoverProjectDocs` unit tests |
| `src/integration.test.ts` | Extend with project_doc → embed → link → verify flow |
