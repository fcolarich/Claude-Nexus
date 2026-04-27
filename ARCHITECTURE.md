# Claude Nexus — Architecture Reference

## Project Structure

```
claude-nexus/
├── src/
│   ├── core/           # Shared DB, search, types
│   ├── web/            # Express API server + session monitor
│   ├── frontend/       # Svelte 5 SPA (views, components, lib)
│   ├── indexer/        # Filesystem scanner, parser, watcher
│   ├── mcp/            # MCP server for Claude integration
│   └── cli/            # CLI entry point
├── dist-frontend/      # Vite build output (served by Express)
├── ARCHITECTURE.md
└── package.json
```

---

## Backend (`src/web/server.ts`)

- **Framework**: Express 5.x
- **Port**: `3210` (override with `NEXUS_PORT` env var)
- **Startup sequence**:
  1. Open SQLite DB via `openDatabase()`
  2. Run `initializeSchema(db)` — creates tables/triggers if absent
  3. `runFullIndex(db)` — scans all known paths and populates atoms
  4. `refreshSessionStatuses(db)` — updates session active/idle/waiting state
  5. Repeating intervals: re-index every 60s, refresh session status every 10s

### Key API Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dashboard` | Stats, recent sessions, project summaries |
| GET | `/api/sessions` | List sessions — accepts `?project=` and `?status=` |
| DELETE | `/api/sessions/:id` | Delete session (tolerates missing JSONL file) |
| GET | `/api/memories` | List memory atoms — accepts `?project=` |
| GET | `/api/memories/:id` | Single atom with links |
| PUT | `/api/atoms/:id` | Update atom body (rewrites file + re-indexes) |
| DELETE | `/api/atoms/:id` | Delete atom — tolerates ENOENT, logs enriched errors |
| POST | `/api/atoms/create-memory` | Write new memory file to `~/.claude/memory/` |
| GET | `/api/search` | FTS5 search — accepts `?q=`, `?type=`, `?project=`, `?limit=` |
| GET | `/api/projects` | Distinct project names from atoms table |
| DELETE | `/api/projects/:name` | Delete all sessions + atoms for a project (tolerates ENOENT) |
| GET | `/api/plans` | List plan atoms |
| GET | `/api/agents` | List agent atoms |
| GET | `/api/skills` | List skill atoms |
| GET | `/api/tasks` | List task atoms — accepts `?project=`, `?status=`, `?priority=`, `?include_done=` |
| PATCH | `/api/tasks/:id` | Update task status |
| POST | `/api/tasks` | Create task atom |

### File ↔ DB Lifecycle

- **Create**: Write `.md` file to disk → indexer picks it up on next 60s cycle (or manual `runFullIndex`)
- **Read**: DB query (atoms table)
- **Update**: Write body to disk file + call `reindexFile(db, path)` immediately
- **Delete**: `unlinkSync(source_path)` (ENOENT tolerated) → `DELETE FROM atoms WHERE source_path = ?`

---

## Database (`src/core/database.ts`)

- **Engine**: SQLite via `better-sqlite3`, WAL mode, foreign keys enabled
- **Location**: `~/.claude-nexus/nexus.db`

### Tables

#### `atoms`
Core knowledge units. One row per indexed file.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Unique identifier |
| `title` | TEXT | From frontmatter `name:` |
| `body` | TEXT | File body after frontmatter |
| `atom_type` | TEXT | `memory`, `agent`, `skill`, `plan`, `feedback`, `reference`, `project_note`, `architecture`, `task` |
| `scope` | TEXT | `global`, `shared`, `project` |
| `source_path` | TEXT | Absolute path to source file |
| `source_type` | TEXT | `memory_file`, `agent_def`, `skill_def`, `plan_file`, `nexus_native` |
| `project` | TEXT | Project name (nullable for global atoms) |
| `tags` | TEXT | JSON array |
| `content_hash` | TEXT | MD5 of file content (change detection) |
| `frontmatter` | TEXT | Raw YAML frontmatter |
| `status` | TEXT | Task status (`ready`, `in_progress`, `blocked`, `done`) |
| `priority` | INTEGER | Task priority |
| `blocks` | TEXT | JSON array of task IDs this blocks |
| `blocked_by` | TEXT | JSON array of task IDs blocking this |
| `discovered_from` | TEXT | Session or source that created this task |

#### `atom_links`
Semantic edges between atoms.

- `source_id → atoms(id)` ON DELETE CASCADE
- `target_id → atoms(id)` ON DELETE CASCADE
- `link_type`: `references`, `extends`, `refines`, `contradicts`, `supports`, `duplicates`, `related`
- `confidence`: float 0–1

#### `sessions`
One row per Claude Code session JSONL file (CLI sessions) or `audit.jsonl` file (Cowork sessions).

| Column | Notes |
|--------|-------|
| `session_id` | UUID from JSONL / audit.jsonl |
| `project` | Working directory slug (CLI: dir name; Cowork: derived from `userSelectedFolders[0]`) |
| `jsonl_path` | Absolute path to `.jsonl` or `audit.jsonl` conversation file |
| `status` | `active`, `waiting_input`, `processing`, `idle`, `dead` |
| `title`, `custom_title` | Display name (custom overrides auto) |
| `summary` | Auto-extracted from first user message |
| `message_count`, `input_tokens`, `output_tokens`, `estimated_cost` | Usage stats |
| `is_cowork` | `1` for Cowork desktop-app sessions, `0`/null for CLI sessions |
| `workspace_id` | Cowork workspace UUID (null for CLI sessions) |
| `participant_id` | Cowork participant UUID (null for CLI sessions) |

#### `diagnostics`
Health check issues (`broken_reference`, `missing_frontmatter`, `duplicate`, `orphan`, `stale`). ON DELETE CASCADE from atoms.

#### `atoms_fts` (virtual)
FTS5 full-text index over `title`, `body`, `tags`. Porter tokenizer + unicode61.

Three triggers keep it in sync:
- `atoms_ai` — AFTER INSERT
- `atoms_ad` — AFTER DELETE
- `atoms_au` — AFTER UPDATE

---

## Search (`src/core/search.ts`)

- **Function**: `search(db, query, options?): SearchResult[]`
- **Query sanitization**: wraps tokens in double-quotes (prevents FTS5 injection), preserves `AND`/`OR`/`NOT` operators and `*` prefix wildcards
- **SQL**: `SELECT ... FROM atoms_fts JOIN atoms ... WHERE atoms_fts MATCH ?` with optional `project`, `type`, `scope` filters
- **Ranking**: BM25 via FTS5 `rank` column
- **Snippet**: FTS5 `snippet()` function with `<mark>` tags, 40 tokens context
- **Limit**: default 20 results, configurable via `?limit=`

---

## Indexer (`src/indexer/`)

- **`indexer.ts`**: `runFullIndex(db)` — scans configured directories, hashes files, upserts changed atoms; also calls `indexCoworkSession()` for each discovered Cowork session
- **`parser.ts`**: Parses frontmatter (via `gray-matter`) to extract title, type, tags, body
- **`scanner.ts`**: Walks filesystem for `.md` files and session JSONL files; `discoverCoworkSessions()` finds Cowork `audit.jsonl` files under the Windows Claude package directory
- **`watcher.ts`**: Optional filesystem watcher for hot-reload (not currently active in prod)
- **`session-titles.ts`**: Extracts meaningful titles from JSONL session files

### Indexed Directories
- `~/.claude/agents/` — agent definitions
- `~/.claude/skills/*/SKILL.md` — skill definitions
- `~/.claude/plans/` — plan files
- `~/.claude/projects/*/memory/` — per-project memory atoms
- `~/.claude/projects/*/*.jsonl` — CLI session transcripts
- `%LOCALAPPDATA%\Packages\Claude_*\...\local-agent-mode-sessions\**\audit.jsonl` — Cowork desktop-app sessions (Windows only)

### Cowork Session Indexing
Cowork sessions use `audit.jsonl` (same JSONL format as CLI sessions, plus `_audit_hmac`/`_audit_timestamp` fields). Each session directory has a companion `.json` sibling (at `<participantDir>/<sessionDirName>.json`) that contains the real project folder in `userSelectedFolders[0]` and a human-readable `title`. `indexCoworkSession()` reads both files and stores the session with `is_cowork=1`.

---

## Frontend (`src/frontend/`)

- **Framework**: Svelte 5, Vite 6
- **Entry**: `main.ts` → `App.svelte`

### Routing

No URL-based routing. Uses Svelte stores:

```ts
// src/frontend/lib/router.ts
export const currentRoute = writable<Route>("dashboard");
export const routeParams  = writable<Record<string, string>>({});
export function navigate(route: Route, params = {}) { ... }
```

`App.svelte` conditionally renders views based on `$currentRoute`. Browser URL never changes.

### Views (`src/frontend/views/`)

| View | Route key | Notes |
|------|-----------|-------|
| `Dashboard.svelte` | `dashboard` | Project grid + recent sessions; remove project button on hover |
| `Sessions.svelte` | `sessions` | Status + project filter; session detail + conversation reader |
| `Memories.svelte` | `memories` | Tree browser + atom editor; "+ New Memory" button |
| `Search.svelte` | `search` | Persistent search via `searchStore`; auto-searches on re-entry |
| `Plans.svelte` | `plans` | Plan atom list |
| `Agents.svelte` | `agents` | Agent definition list |
| `Skills.svelte` | `skills` | Skill definition list |
| `Tasks.svelte` | `tasks` | Task board |

### Global State

| Store | File | Purpose |
|-------|------|---------|
| `currentRoute` | `lib/router.ts` | Active view |
| `routeParams` | `lib/router.ts` | Params passed with navigation (e.g. `{ id }`) |
| `searchStore` | `lib/searchStore.ts` | Persists search query, filter, results across navigation |

### Polling (`src/frontend/lib/poll.ts`)

Views poll the API on a timer. Two intervals:
- `POLL.FAST` — Sessions view (frequent, for live status)
- `POLL.NORMAL` — All other views

### API Client (`src/frontend/lib/api.ts`)

Thin wrapper over `fetch`. Base URL: `http://localhost:3210`.
All calls are typed; error handling throws `new Error(status statusText)`.

---

## MCP Server (`src/mcp/server.ts`)

Exposes Claude Nexus tools to Claude Code via the Model Context Protocol:
- `nexus_search` — full-text search
- `nexus_context` — get atom content + links
- `nexus_remember` — create a memory atom
- `nexus_sessions`, `nexus_tasks`, `nexus_tasks_create`, `nexus_task_update`
- `nexus_stats`, `nexus_health`, `nexus_project`, `nexus_shared`, `nexus_reindex`

---

## Key Patterns

- **ENOENT tolerance**: Both `DELETE /api/sessions/:id` and `DELETE /api/atoms/:id` skip `unlinkSync` errors when `e.code === 'ENOENT'` and proceed with DB cleanup. Other unlink errors return 500 with `{ error, code, path }`.
- **Cascade deletes**: `atom_links` and `diagnostics` use `ON DELETE CASCADE` — deleting an atom cleans them automatically.
- **FTS5 triggers**: Insert/update/delete triggers keep `atoms_fts` in sync with `atoms` without manual index maintenance.
- **Memory creation**: `POST /api/atoms/create-memory` writes the file to disk immediately but does **not** index it — it appears after the next 60s re-index cycle.
- **Session status**: Determined by `session-monitor.ts` checking JSONL file modification times and presence of `<parameter name="content">` blocks, not by DB flags.
- **Project scope**: A "project" is purely derived from `atoms.project` or `sessions.project`. There is no separate projects table — the project list is computed via `SELECT DISTINCT`.
