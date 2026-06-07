# Claude Nexus — Architecture Decisions

Each entry records a structural/technical decision, the alternatives considered, and the reason for the choice.
**Append new entries; never edit old ones — they document history.**
Maintained via the `add-adr` skill. Long topical detail spills into linked sub-files following this same format.

Paired with [`design.md`](design.md) — a change here often implies a design decision there, and vice versa.

---

## ADR-001 — Initial architecture baseline: three-layer autonomous memory engine

**Decision:** Claude Nexus v2 is structured as three cooperating layers: (1) a capture pipeline (`src/capture/`) driven by Claude Code hooks that reads session transcripts, extracts typed memories via Haiku 4.5, and writes them to a SQLite `memories` table; (2) a recall layer (`src/core/recall.ts`) that ranks memories by decay-adjusted confidence × help-rate and injects them at session start via the `SessionStart` hook; (3) a v1 atom indexer (`src/indexer/`) retained as a read-only mirror of `~/.claude/` knowledge files. The MCP server (`src/mcp/server.ts`), Express REST API (`src/web/server.ts`), Svelte 5 dashboard, and CLI all sit atop the same SQLite DB. Delivery is via a `claude-nexus` plugin in the local marketplace — `.mcp.json` and `hooks/hooks.json` auto-register with Claude Code.

**Alternatives considered:**
- File-only store (v1): markdown files as system of record — discarded for v2 because DB enables decay scoring, FTS, vector search, and dedup that files cannot.
- External vector DB (Milvus, Qdrant): rejected — sqlite-vec keeps the stack zero-dependency and the corpus is small enough (< 50k atoms) that in-process is sufficient.
- Tauri desktop app (removed in v2): replaced by a plain browser SPA served by Express, eliminating native build complexity.

**Reason:** SQLite as system of record provides ACID writes, FTS5 full-text search, sqlite-vec vector similarity, and schema migrations in a single embedded file. The capture pipeline is decoupled from the web server — hooks spawn `dist/capture/runner.js` detached, so capture never blocks a session. The three-layer separation (capture / recall / indexer) makes each subsystem independently testable and replaceable.

---

## ADR-002 — Numbered migration framework with schema_version guard

**Decision:** All schema changes are numbered migrations stored in a `MIGRATIONS` array in `src/core/database.ts`. A `schema_version` table records which have run; on init, migrations with `version > current` apply in order. Each migration is idempotent (`IF NOT EXISTS` / guarded `ALTER`). The version row is only recorded on success — a partial failure followed by a retry is safe.

**Alternatives:** ORMs with auto-migration (TypeORM, Prisma) — rejected to keep the stack flat and avoid ORM overhead on a performance-sensitive hot path (session start recall).

**Reason:** The guarded migration pattern (used in migrations 1–6) handles pre-versioning DBs, partial failures, and the SQLite constraint that CHECK constraints cannot be modified via ALTER TABLE (migration 6 uses a full table recreate inside `foreign_keys = OFF` for this reason).

---

## ADR-003 — Corpus expansion v2.1: hybrid BM25 + dense auto-linking via RRF

**Decision:** After embedding each new atom or memory, `linkAtom` / `linkMemory` (`src/core/links.ts`) run a hybrid retrieval: dense KNN over `atoms_vec` / `memories_vec` (TOP_K=12) merged with in-memory BM25 (`wink-bm25-text-search`) via Reciprocal Rank Fusion (K=60). Results above cosine 0.86 get `duplicates` links; 0.70–0.86 get `related` links. Links are bidirectional (two rows in `atom_links` / `memory_links`). A `linked_at` skip guard prevents re-linking when `linked_at > updated_at`. The BM25 corpus is built in-memory per call (never persisted); for batch runs (`embedUnindexed`), one corpus is built once and passed to all `linkAtom` calls to avoid O(N²) rebuilds. `project_doc` atoms (`.md` files from `sessions.cwd` paths) are indexed alongside `~/.claude/` atoms as of migration 6.

**Alternatives:** Dense-only linking — misses keyword-exact atoms with low cosine (short config snippets). FTS5-only — no semantic similarity. External graph DB — unnecessary complexity.

**Reason:** Hybrid retrieval catches both keyword-identical and semantically similar content. RRF is cheap, well-understood, and requires no score normalization before merging. wink-bm25-text-search is pure JS (zero native deps).

<!-- Append ADR-004, ADR-005, … below. Format: Decision / Alternatives / Reason. -->

## ADR-004 — nexus_crossref: runtime hybrid search as a distinct tool from passive auto-linking

**Decision:** `nexus_crossref` is a runtime MCP tool (user/agent-initiated) that runs the same hybrid KNN + BM25 RRF retrieval as `linkAtom`/`linkMemory`, but returns ranked results instead of writing links. This is architecturally distinct from the passive auto-linking in ADR-003: auto-linking fires once after each write and persists edges to `atom_links`/`memory_links`; `nexus_crossref` is ephemeral, fires on demand, and returns both atoms and memories in a unified ranked list. The tool accepts a query string and optional project/scope filters and returns results above a configurable threshold. It does not mutate the DB.

**Alternatives considered:**
- Exposing links table directly: less useful — the caller wants ranked candidates, not raw edges.
- Merging into `nexus_search`: `nexus_search` is FTS-primary with optional vector; `nexus_crossref` is hybrid-first and optimized for finding related content around a known topic.

**Reason:** Separating read-path cross-ref from write-path linking keeps both paths simple and independently testable. The tool is especially useful for "what else do I know about X" queries during sessions where the auto-linking pass hasn't yet run (e.g. newly captured memories before the next consolidation).
