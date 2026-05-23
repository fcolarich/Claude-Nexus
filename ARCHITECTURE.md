# Claude Nexus v2 — Architecture Reference

Claude Nexus v2 is an **autonomous memory engine** for Claude Code. It watches
sessions, distills durable knowledge into typed *memories*, and injects the
relevant ones at the start of future sessions — closing the loop so Claude Code
learns across sessions instead of starting cold every time.

v1 was a passive file-indexer (a Zettelkasten dashboard over `.md` files). v2
keeps that indexer — `atoms` still mirror on-disk agents/skills/plans/tasks —
but the new core is the DB-owned `memories` table and the capture → recall loop
built around it.

---

## Project Structure

```
claude-nexus/
├── src/
│   ├── core/           # DB, memories, recall, decay, consolidate, distill, llm, embeddings, config, search
│   ├── capture/        # Capture pipeline: transcript → extract → reflect → export; runners, backfill
│   ├── indexer/        # Filesystem scanner/parser/watcher; session-message FTS
│   ├── web/            # Express API server + session monitor
│   ├── frontend/       # Svelte 5 SPA (browser dashboard)
│   ├── mcp/            # MCP server (19 tools)
│   └── cli/            # `nexus` CLI entry point
├── hooks/              # nexus-capture.mjs (Stop/PreCompact/SessionEnd hook)
├── dist/               # tsc output (runner.js, load-runner.js, mcp/server.js run from here)
├── dist-frontend/      # Vite build output (served by Express)
├── extraction_models.yaml   # model + pipeline config
├── ARCHITECTURE.md
└── package.json
```

Tauri was removed in v2. The dashboard is now a plain browser app — `npm run dev`
runs the Express API and the Vite dev server concurrently.

---

## The Memory Loop

```
SessionStart hook ─► recall ─► inject "Recalled Memory" as additionalContext
       │
   (session runs)
       │
Stop / PreCompact / SessionEnd hook ─► Reflector
       │                                  ├─ read new transcript lines (cursor)
       │                                  ├─ condense (Observer)
       │                                  ├─ Haiku extracts typed memories
       │                                  ├─ semantic dedup / merge
       │                                  ├─ write to `memories`
       │                                  └─ markdown export
```

- **Capture** is driven by the `Stop` / `PreCompact` / `SessionEnd` hooks. Each
  fire spawns the Reflector, which reads only transcript lines added since its
  last run (per-session cursor `sessions.last_reflected_index`), so frequent
  `Stop` events are cheap.
- **Recall** is driven by the `SessionStart` hook. It runs a pure, budgeted,
  decay-ranked read of approved memories and emits them as `additionalContext`.
- The capture pipeline is the **system of record in the DB**; the markdown
  export is a regenerated human-readable mirror.

---

## Database (`src/core/database.ts`)

- **Engine**: SQLite via `better-sqlite3`, WAL mode, foreign keys on, 5s busy timeout
- **Location**: `~/.claude-nexus/nexus.db`
- **Vector search**: `sqlite-vec` loaded at open time — non-fatal if unavailable
  (vector tables/queries silently degrade to no-ops)

### Migration framework

Every schema change is a **numbered migration**. A `schema_version` table records
which have run; on init, migrations with `version > current` apply in order.
Migrations are idempotent (`IF NOT EXISTS` / guarded `ALTER`) so a partial failure
followed by a retry is safe — the version row is recorded only on success.

| # | Name | Effect |
|---|------|--------|
| 1 | `baseline-v1-schema` | Builds the v1 schema (`atoms`, `atom_links`, `sessions`, `diagnostics`, `atoms_fts`, `atoms_vec`); brings a pre-versioning DB current via guarded ALTERs (task support, Cowork columns, `load_at_init`) |
| 2 | `memories-tables` | The v2 core — `memories`, `memory_links`, `memories_fts`, `memories_vec` |
| 3 | `session-reflection-cursor` | Adds `sessions.last_reflected_index` (the Reflector transcript cursor) |
| 4 | `import-legacy-memory-atoms` | One-time copy of v1 `memory`/`feedback`/`architecture` atoms into `memories` (mapped to memory types, `review_status='approved'`). Idempotent `INSERT OR IGNORE`; source atoms left in place |
| 5 | `session-messages-fts` | Adds `session_messages_fts` — user-facing transcript search, never fed to the LLM |

### Tables

#### `atoms`
v1 carryover. One row per indexed `.md` file (agents, skills, plans, tasks,
project notes). Columns: `id`, `title`, `body`, `atom_type` (`memory`, `agent`,
`skill`, `plan`, `feedback`, `reference`, `project_note`, `architecture`,
`task`), `scope` (`global`/`shared`/`project`), `source_path`, `source_type`,
`project`, `tags` (JSON), `content_hash`, `frontmatter`, `created_at`,
`updated_at`, `load_at_init`, plus task fields (`status`, `priority`, `blocks`,
`blocked_by`, `discovered_from`).

#### `atom_links`
Semantic edges between atoms. `source_id`/`target_id` FK to `atoms(id)` with
`ON DELETE CASCADE`; `link_type` ∈ {references, extends, refines, contradicts,
supports, duplicates, related}; `confidence` 0–1.

#### `sessions`
One row per Claude Code session (CLI `.jsonl`) or Cowork `audit.jsonl`. Key
columns: `session_id`, `project`, `git_branch`, `slug`, `jsonl_path`,
`started_at`, `last_active`, `status` (`active`/`waiting_input`/`processing`/
`idle`/`dead`), token/cost/`message_count`/`subagent_count` usage stats,
`title`/`custom_title`, `summary`, Cowork fields (`is_cowork`, `workspace_id`,
`participant_id`), and **`last_reflected_index`** — the Reflector's per-session
cursor: the count of transcript lines already processed. Capture only reads
lines beyond it.

#### `memories` — the v2 core
DB-owned distilled knowledge, written by the Reflector. **Not** file-mirrored
(unlike `atoms`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Content-addressed: `sha256(memory_type + "\n" + body)[:16]` — identical (type, body) collapses to one row |
| `title` | TEXT | Short noun phrase |
| `body` | TEXT | 1–4 self-contained sentences (durable lesson + its *why*) |
| `memory_type` | TEXT | `preference`, `convention`, `failure`, `correction`, `decision`, `insight`, `tool_quirk`, `reference`, `handoff` |
| `scope` | TEXT | `global`, `shared`, `project` |
| `project` | TEXT | Project slug (NULL for global/shared) |
| `confidence` | REAL | **Intrinsic** trust 0–1 (default 0.6). Changed only by reconfirm/verify/feedback — never by decay |
| `decay_class` | TEXT | `stable`, `architecture`, `api_contract`, `implementation` — sets the decay schedule |
| `last_verified_at` | TEXT | Last reconfirmation. The decay clock — drives effective confidence |
| `use_count` | INT | Times this memory was recalled |
| `help_count` | INT | Times a recall was marked helpful — `help_count/use_count` feeds recall ranking |
| `source_session_id` | TEXT | Session the Reflector extracted it from |
| `discovered_from` | TEXT | Provenance pointer |
| `superseded_by` | TEXT | FK → `memories(id)` `ON DELETE SET NULL`. Set when a duplicate/distill merge retires this memory — kept as an audit trail, hidden from recall/export |
| `review_status` | TEXT | `pending`, `approved`, `rejected`. Only `approved` memories are recalled |
| `tags` | TEXT | JSON array |
| `content_hash` | TEXT | `sha256(body)` |
| `created_at` / `updated_at` | TEXT | timestamps |
| `load_at_init` | INT | 0/1 — pinned memories are always recalled, bypassing the confidence threshold |

#### `memory_links`
Edges spanning memories and atoms. **No FK** — the target may live in either
table. Same `link_type` set as `atom_links`. Consolidation writes `duplicates`
links; distill writes `refines` links.

#### FTS5 virtual tables
- `atoms_fts` — full-text over atom `title`/`body`/`tags`; kept in sync by
  insert/delete/update triggers on `atoms`.
- `memories_fts` — same shape over `memories`; insert/delete/update triggers.
- `session_messages_fts` — `session_id`/`role`/`text` over raw transcript text;
  rebuilt wholesale at web-server startup. **User-facing only** — searched by the
  dashboard, never injected into the LLM.

All three use the `porter unicode61` tokenizer.

#### sqlite-vec virtual tables
- `atoms_vec` — `vec0(embedding float[1024])` for atom vectors.
- `memories_vec` — `vec0(embedding float[1024])` for memory vectors; used by
  recall, dedup, consolidate, and distill.

Both created in a `try/catch` (skipped if `sqlite-vec` did not load) and pruned
by an `AFTER DELETE` trigger on their parent table. Width 1024 must match
`embedding.dimensions` in `extraction_models.yaml`.

---

## Capture Pipeline (`src/capture/`)

The Reflector and its supporting stages. Filesystem-light by design so the core
(`reflect()`) is unit-testable; markdown export is the caller's job.

### `transcript.ts` — Observer / condenser
`readTranscriptWindow(jsonlPath, fromIndex)` reads a session JSONL from the
cursor index to the end and condenses it for the LLM:
- Strips harness noise (`<system-reminder>`, local-command/system blocks).
- Renders text, `tool_use` (input truncated), and `tool_result` (output capped)
  blocks; drops `thinking` blocks.
- Caps condensed text at ~60k chars (keeps the most recent).
- Reports `hasSignal`: an **Observer gate** — extraction runs only when the
  window has a real exchange (≥1 user message and ≥4 exchanges), a tool error,
  or a correction/preference marker phrase. Trivial windows skip the LLM call.

### `extract.ts` — Haiku extraction
`extractMemories(condensed, ctx)` calls the configured extraction model with a
strict system prompt and parses a JSON array of `MemoryCandidate`s. The prompt
defines the nine `memory_type`s and four `decay_class`es, demands self-contained
bodies with rationale, and biases toward **0 memories over noise**.
`parseCandidates()` tolerates fenced/garbage output, validates enums, clamps
confidence to [0,1], and caps at 20 candidates.

### `reflector.ts` — orchestrator
`reflect(db, opts, deps)`:
1. Ensure a `sessions` row exists (to hold the cursor).
2. Read the transcript window from `last_reflected_index`.
3. Observer gate: if no new lines or no signal, advance the cursor and return
   `skipped: true` — no LLM call.
4. Extract memory candidates.
5. For each candidate: embed the body, find the most similar existing memory;
   if cosine ≥ `dedup_cosine_threshold`, **reconfirm** it (`touchMemory`) instead
   of inserting. Otherwise insert — `review_status='approved'` if confidence ≥
   `auto_approve_confidence`, else `pending` — and embed it.
6. Advance the cursor to the new line count.

Idempotent: re-running only sees new lines; content-addressed ids + semantic
dedup collapse repeats into reconfirmations.

### `export.ts` — markdown export
`exportAll(db)` materializes every approved, non-superseded memory to
`capture.export_dir` — one subdir per project (`_global` for global/shared),
each with a `MEMORY.md` index and one `.md` file per memory (YAML frontmatter +
body). Stale `.md` files are pruned each run. The DB is authoritative; this is a
regenerated mirror. `export_dir` is a Nexus-owned sandbox until capture is
verified, then deliberately repointed at `~/.claude/projects/<project>/memory`.

### `runner.ts` / `load-runner.ts` — hook entry points
- `runner.js` — spawned (detached) by `nexus-capture.mjs`. Opens the DB, runs
  `reflect()`, exports if anything changed. Independent of the web server.
- `load-runner.js` — registered directly as the `SessionStart` hook command.
  Reads the hook payload from stdin, runs `recallMemories()`, writes the markdown
  as `hookSpecificOutput.additionalContext`. Synchronous, DB-direct, best-effort
  — a failure never blocks session start.

### `backfill.ts` — retroactive capture
The hooks only fire going forward; `backfillSessions()` runs the same Reflector
over sessions already on disk. Selective (filters: project, min messages, since
date; default limit 50) and supports `dryRun` to preview batch size before
spending LLM calls. Idempotent via the per-session cursor.

---

## Memory Core (`src/core/`)

### `memories.ts` — data layer
CRUD over `memories`. `insertMemory()` uses the content-addressed id with
`INSERT OR IGNORE` (returns `inserted: false` on collision). `touchMemory()` /
`verifyMemory()` reconfirm a memory — nudge `confidence` up and reset
`last_verified_at`. `recordFeedback()` increments `use_count`/`help_count`.
Embedding helpers (`embedMemory`, `embedUnindexedMemories`) write unit-normalized
vectors to `memories_vec`. `findSimilarMemory()` does a KNN over `memories_vec`
and converts L2 distance to cosine similarity — the dedup primitive.

### `recall.ts` — budgeted retrieval
`recallMemories(db, {project, query, maxTokens})`:
- Dual-bank query: project-scoped memories **+** global/shared memories.
- Eligibility: `review_status='approved'`, not superseded, and **effective
  (decayed) confidence** ≥ `recall.min_confidence` — unless `load_at_init=1`
  (pinned memories bypass the threshold).
- Ranking: `effectiveConfidence × helpRate` (helpRate from `help_count/use_count`);
  `load_at_init` memories sort first.
- Budget walk: emit full bodies until `max_tokens` is reached, then titles-only.
- Pure read — no mutation, no network — cheap enough for the SessionStart hot path.

### `decay.ts` — computed confidence decay
Decay is **non-destructive**. Stored `confidence` is intrinsic; decay is a
multiplier computed from `last_verified_at`, so reconfirming a memory instantly
restores its effective confidence.

```
effectiveConfidence = confidence × decayFactor(decay_class, last_verified_at)
```

Schedule per `decay_class` (grace period / half-life):

| decay_class | grace | half-life |
|-------------|-------|-----------|
| `stable` | — | never decays (preferences, conventions) |
| `architecture` | 30d | 60d |
| `api_contract` | 14d | 30d |
| `implementation` | 7d | 14d |

`flagStaleMemories()` rewrites the `stale` diagnostics each run for approved
memories whose effective confidence has fallen below the recall threshold.

### `consolidate.ts` — structural cleanup (autoDream)
`consolidateMemories()`: backfill missing embeddings → prune **rejected**
memories → merge near-duplicates (cosine ≥ `dedup_cosine_threshold`). The
lower-confidence memory of a similar pair is `superseded_by` the higher one and
a `duplicates` link is recorded. Conservative: decayed memories are **never**
auto-deleted; only explicitly rejected memories are removed.

### `distill.ts` — LLM cluster-rewrite cleanup
`distillMemories()` goes further than consolidate: it clusters *related*
memories (similarity in the `0.70 … dedup_threshold` band), and asks the
extraction model to rewrite each cluster into one tighter, non-redundant memory
(originals superseded, `refines` links recorded). Also sanitizes verbose
singletons (> 800 chars) in place. Heavier — it makes LLM calls.

### `llm.ts` — shared LLM client
Provider-aware, driven by `extraction` in `extraction_models.yaml`:
- `claude-agent-sdk` (default) — Haiku via the local `claude` CLI through the
  Claude Agent SDK (OAuth, no API key; `claude login` required).
- `openai-compatible` — POSTs to a local llama.cpp / Ollama `/v1/chat` endpoint.

`callModel()` returns `''` on any failure (logged, non-throwing) so the capture
and distill pipelines degrade gracefully.

### `embeddings.ts` / `config.ts`
`generateEmbedding()` POSTs to the Ollama embeddings endpoint
(`mxbai-embed-large`, 1024-dim); returns `null` on any error — non-fatal.
`getNexusConfig()` loads `extraction_models.yaml` from the repo root (cached),
merging over baked-in defaults; a missing file or key falls back silently.

### `search.ts`
Hybrid (FTS5 + vector) search over `atoms`, plus the v1 helpers
(`fetchContext`, `getSharedKnowledge`, `getProjectContext`, `listSessions`,
`getStats`, `getDiagnostics`). `sanitizeFts5Query()` quotes tokens to prevent
FTS5 injection while preserving operators and prefix wildcards.

---

## Indexer (`src/indexer/`)

The v1 file-indexer, retained for `atoms`.

- `indexer.ts` — `runFullIndex(db)` scans configured directories, hashes files,
  upserts changed atoms, runs an embedding pass; also indexes Cowork sessions.
- `parser.ts` — frontmatter parsing (`gray-matter`); atom id / hash helpers.
- `scanner.ts` — walks the filesystem for `.md` and session JSONL files;
  discovers Cowork `audit.jsonl` sessions.
- `watcher.ts` — optional filesystem watcher (`nexus watch`); not active in prod.
- `session-titles.ts` — extracts session titles from JSONL.
- `session-messages.ts` — builds `session_messages_fts` from raw transcripts and
  serves `searchSessionMessages()`. A **user-facing** feature — the LLM gets
  distilled memories via recall, not raw transcript text.

---

## Web Server (`src/web/server.ts`)

- **Framework**: Express 5, port `3210` (`NEXUS_PORT` override)
- **Startup**: open DB → `initializeSchema()` (runs migrations) → `runFullIndex()`
  → repeating intervals: session-status refresh (10s), full re-index +
  `flagStaleMemories()` (60s), `reindexSessionMessages()` (once, ~3s after start)
- Serves the built frontend from `dist-frontend/`; SPA fallback for non-API routes

### Route groups

| Group | Routes |
|-------|--------|
| **Recall** | `POST /api/recall` — budgeted memory retrieval (pure read) |
| **Reflect** | `POST /api/reflect` — run the Reflector over a transcript (202, background) |
| **Memories CRUD** | `GET /api/memories`, `GET/PUT/DELETE /api/memories/:id` — list/read/edit/delete; responses include computed `effective_confidence` |
| **Memory review/verify/feedback** | `POST /api/memories/:id/review` (approve/reject/pending), `POST /api/memories/:id/verify` (reset decay clock), `POST /api/memories/:id/feedback` (helped y/n) |
| **Consolidate / distill** | `POST /api/consolidate`, `POST /api/distill` |
| **Sessions** | `GET /api/sessions`, `GET /api/sessions/:id`, `PATCH /api/sessions/:id` (custom title), `GET /api/sessions/:id/messages` (rich blocks), `GET /api/sessions/:id/references`, `DELETE /api/sessions/:id`, `GET /api/sessions/search` (transcript FTS) |
| **Knowledge (atoms)** | `GET /api/dashboard`, `/api/plans`, `/api/agents`, `/api/skills`, `/api/tasks` (+ `PATCH`/`POST`), `/api/search`, `/api/projects` (+ `DELETE`), `/api/diagnostics`, `/api/stats`, atom raw/edit/delete/create-memory |

### Key patterns
- **ENOENT tolerance** — session/atom/project deletes skip a missing source file
  and still clean the DB; other unlink errors return 500.
- **Cascade deletes** — `atom_links` and `diagnostics` cascade from `atoms`.
- **FTS triggers** — `atoms_fts` / `memories_fts` stay in sync without manual
  maintenance.
- **Reflect is async** — `POST /api/reflect` returns 202 immediately; extraction
  + write + export run in the background.

---

## Frontend (`src/frontend/`)

- **Framework**: Svelte 5, Vite 6 — a browser SPA (no Tauri). `npm run dev` runs
  the Express API and Vite dev server together.
- **Routing**: store-based, no URL routing. `currentRoute` / `routeParams` stores
  in `lib/router.ts`; `App.svelte` conditionally renders views.
- **Views**: `Dashboard`, `Sessions`, `Memories`, `Review` (the pending-memory
  approval queue — drives the review gate), `Search`, `Plans`, `Agents`,
  `Skills`, `Tasks`.
- **State**: `currentRoute`/`routeParams` (router), `searchStore` (persisted
  search), `reviewStore` (`pendingReviewCount` badge).
- **Polling** (`lib/poll.ts`): `POLL.FAST` for the live Sessions view,
  `POLL.NORMAL` elsewhere.
- **API client** (`lib/api.ts`): typed `fetch` wrapper, base `http://localhost:3210`.

---

## MCP Server (`src/mcp/server.ts`)

Exposes Claude Nexus to Claude Code over the Model Context Protocol — **19 tools**.
On startup it opens the DB, runs migrations, and kicks off a full index.

| Tool | Purpose |
|------|---------|
| `nexus_search` | Hybrid FTS + vector search across atoms |
| `nexus_context` | Multi-topic smart fetch, merged into one response |
| `nexus_recall` | Budgeted, decay-ranked memory recall for the current project |
| `nexus_shared` | Global/shared knowledge for session start |
| `nexus_set_init` | Toggle `load_at_init` on a global/shared atom |
| `nexus_project` | All knowledge atoms for a project |
| `nexus_sessions` | List sessions with status/usage |
| `nexus_health` | Diagnostics report |
| `nexus_remember` | Store a knowledge atom (or a task atom) |
| `nexus_tasks` | List task atoms (resolves dependency chains) |
| `nexus_tasks_create` | Bulk-create task atoms |
| `nexus_task_update` | Update task status / dependencies / file a discovered task |
| `nexus_stats` | DB statistics (atoms, memories, review breakdown, links, sessions) |
| `nexus_verify` | Reconfirm a memory — reset its decay clock |
| `nexus_feedback` | Record whether a recalled memory helped |
| `nexus_consolidate` | Structural cleanup sweep (embed, prune rejected, merge dupes) |
| `nexus_distill` | LLM cluster-rewrite cleanup of existing memories |
| `nexus_backfill` | Retroactive memory capture from past sessions |
| `nexus_reindex` | Force a full atom re-index |

---

## Plugin Delivery

The MCP server and hooks auto-register through the **`claude-nexus` plugin** in
the local marketplace — no manual `~/.claude/settings.json` editing.

- `.mcp.json` registers `dist/mcp/server.js` as the `claude-nexus` MCP server.
- `hooks/hooks.json` registers:
  - `SessionStart` → `dist/capture/load-runner.js` (recall — needs stdout, so a
    direct command, not a detached spawn)
  - `Stop` / `PreCompact` / `SessionEnd` → `hooks/nexus-capture.mjs` (capture —
    reads the payload, spawns `dist/capture/runner.js` detached, exits 0)

Both point at absolute paths. Run `npm run build` once (and after pulling
pipeline changes) so the `dist/` files the plugin references exist.

---

## Key Patterns

- **DB is the system of record.** `memories` is DB-owned and written by the
  Reflector; the markdown export is a regenerated mirror. `atoms` mirror on-disk
  files. The two are distinct stores.
- **Decay is computed, not destructive.** Stored `confidence` is intrinsic;
  effective confidence = `confidence × decayFactor(last_verified_at)`. Decayed
  memories fall out of recall but are never auto-deleted — `verify` revives them.
- **Review gate.** Low-confidence extractions land `review_status='pending'` and
  are excluded from recall until a human approves them in the dashboard's Review
  view. Only `approved` memories are recalled.
- **Supersession over deletion.** Consolidate/distill merges set `superseded_by`
  rather than deleting — retired memories stay as an audit trail, hidden from
  recall and export. Only explicitly *rejected* memories are pruned.
- **Content-addressed ids.** A memory id is `sha256(memory_type + body)[:16]` —
  identical extractions collapse to one row; semantic dedup catches near-misses.
- **Idempotent, non-blocking capture.** The per-session cursor means re-runs
  only see new lines; the Observer gate skips trivial windows; capture hooks
  always exit 0 — a failure never disrupts a session.
- **Graceful degradation.** Missing `sqlite-vec`, a down embedding model, or an
  unauthenticated LLM each degrade to a no-op (vector features off, `null`
  embedding, `''` completion) rather than crashing.
- **Models.** `mxbai-embed-large` via Ollama for embeddings; Haiku 4.5 via the
  Claude Agent SDK for extraction. Both configured in `extraction_models.yaml`.
