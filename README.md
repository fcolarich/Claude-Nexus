# Claude Nexus

An **autonomous memory engine** for Claude Code. Nexus watches your sessions,
distills durable knowledge into typed memories, and injects the relevant ones
back at the start of future sessions — no manual note-taking, no agent cooperation.

It also indexes your Claude knowledge files (agents, skills, plans, notes) and
ships a web dashboard for browsing memories, sessions, and the review queue.

**Storage:** SQLite + FTS5 + sqlite-vec at `~/.claude-nexus/nexus.db`

---

## How it works

```
UserPromptSubmit ─► prompt-runner hook ─► embed prompt ─► vector search
                                          ─► relevance floor (min_similarity)
                                          ─► inject top matches as context

  ...your session runs, transcript is written to disk...

Stop / PreCompact / SessionEnd ─► nexus-capture hook ─► Reflector
        (background, non-blocking)   reads new transcript lines
                                     ─► Haiku extracts typed memories
                                     ─► dedup / merge vs existing
                                     ─► writes to the memories table
                                     ─► exports markdown mirror
```

- **Capture** — the Reflector reads what changed in the transcript, asks Haiku
  to extract durable memories (preferences, conventions, decisions, failures,
  …), dedup-merges them, and stores them. Low-confidence memories land in a
  **review queue** for human approval.
- **Recall** — at session start, the highest-value memories for the project are
  ranked and injected up to a token budget; the rest are listed by title.
- **Lifecycle** — memories **decay** with age (per type), can be **reverified**
  to reset the clock, accumulate **feedback** (did recall help?), and are swept
  by **consolidation** (merge duplicates, prune rejected).

Memories are the system of record in the DB; a markdown mirror is exported for
human review and git.

---

## Setup

### 1. Prerequisites

- **Node.js 22+**
- **Ollama** with the embedding model: `ollama pull mxbai-embed-large`
- **Authenticated `claude` CLI** — the Reflector calls Haiku through the Claude
  Agent SDK, which drives the local `claude` binary (OAuth, no API key):
  ```bash
  claude login
  ```
  A `401` in the capture logs means the CLI needs a fresh login.

### 2. Build

```bash
cd C:\Fran\claude-nexus
npm install
npm run build          # compiles TypeScript -> dist/  (required by the hooks + MCP server)
```

### 3. Enable the plugin

Nexus ships as the **`claude-nexus` plugin** in the local marketplace. Enabling
it auto-registers both the MCP server (`.mcp.json`) and the capture/recall hooks
(`hooks/hooks.json`) — no manual `settings.json` editing. Restart Claude Code
after enabling so it loads the plugin's hooks.

### 4. Configure (optional)

`extraction_models.yaml` at the repo root controls the embedding model, the
extraction model, recall budget, and capture thresholds. It falls back to sane
defaults if absent.

---

## Hooks

| Event | Hook | Action |
|-------|------|--------|
| `UserPromptSubmit` | prompt-runner | Embed prompt, recall top matches above the relevance floor, inject as additionalContext |
| `Stop` / `PreCompact` / `SessionEnd` | nexus-capture | Spawn the Reflector (detached, non-blocking) |

Capture is self-throttling — a per-session cursor means each run only processes
new transcript lines, and trivial windows skip the LLM call entirely.

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `nexus_recall` | Budgeted recall of the most relevant memories for the project |
| `nexus_search` | Cross-project full-text + vector search over all knowledge |
| `nexus_context` | Smart fetch: multiple topics merged into one response |
| `nexus_project` | All knowledge atoms for a project |
| `nexus_remember` | Store a memory manually |
| `nexus_verify` | Reconfirm a memory — reset its decay clock |
| `nexus_feedback` | Record whether a recalled memory helped |
| `nexus_consolidate` | Cleanup sweep: backfill embeddings, merge duplicates, prune rejected |
| `nexus_distill` | Deeper cleanup: cluster related memories and rewrite each cluster into one |
| `nexus_backfill` | Retroactively extract memories from past sessions (predating the hooks) |
| `nexus_shared` | Global/shared knowledge for session start |
| `nexus_set_init` | Toggle the load-at-init flag on a global/shared atom |
| `nexus_sessions` | List Claude Code sessions |
| `nexus_health` | Diagnostics: broken refs, duplicates, orphans, stale memories |
| `nexus_stats` | Atom / memory / link / session counts |
| `nexus_reindex` | Force a full re-index of knowledge files |
| `nexus_crossref` | Hybrid cross-reference search (KNN + BM25 via RRF) for finding related atoms/memories at query time |

---

## Architecture

| Layer | Detail |
|-------|--------|
| **Database** | SQLite at `~/.claude-nexus/nexus.db`. Numbered migrations via `schema_version`. |
| **`memories`** | The autonomous engine's store — typed, confidence-scored, decaying. FTS5 + sqlite-vec mirrors. |
| **`atoms`** | File-indexed artifacts (agents, skills, plans, notes) — a read-only mirror of `~/.claude/`. |
| **Capture** | `src/capture/` — transcript condenser, Haiku extractor, Reflector, markdown export. |
| **Recall** | `src/core/recall.ts` — decay-ranked, token-budgeted retrieval. |
| **Lifecycle** | `src/core/decay.ts` + `consolidate.ts` — age decay, stale flagging, dedup sweep. |
| **MCP server** | `src/mcp/server.ts` — stdio transport, 17 tools. |
| **Web API** | Express on port 3210 (`src/web/server.ts`). |
| **Dashboard** | Svelte 5 SPA — Memories, Review, Sessions, Search, Plans, Agents, Skills. Browser-based. |
| **CLI** | `src/cli/` — index, search, inspect from the terminal. |

**Models:** `mxbai-embed-large` via Ollama (embeddings, vector search, dedup);
Haiku 4.5 via the Claude Agent SDK (memory extraction).

---

## Developer Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile TypeScript → `dist/` |
| `npm run dev` | Express API + Vite dev server (dashboard at `localhost:5173`) |
| `npm run dev:api` | Express API only, port 3210 |
| `npm run build:frontend` | Production build of the dashboard → `dist-frontend/` |
| `npm test` | Run the Vitest suite |

The web server serves the built dashboard from `dist-frontend/`; open
`http://localhost:3210` in a browser.

---

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — agent instructions and project map
- [`_documents/architecture.md`](_documents/architecture.md) — architecture decisions (ADRs); source files in `_documents/decisions/adr-*.md`
- [`_documents/design.md`](_documents/design.md) — design decisions (DDRs); source files in `_documents/decisions/ddr-*.md`
- [`_documents/references.md`](_documents/references.md) — research and external references
- [`_documents/notes.md`](_documents/notes.md) — operational notes and gotchas
- [`_documents/file-map.md`](_documents/file-map.md) — file/folder map

<!-- The summary + purpose above are kept in sync with CLAUDE.md. Edit via the `update-claude-readme` skill. -->

---

## CLI

```bash
npm run nexus -- <command> [options]
```

| Command | Purpose |
|---------|---------|
| `index` | Index all Claude data (agents, skills, plans, memories, sessions) |
| `search <query>` | FTS search; flags: `-p project`, `-t type`, `-s scope`, `-l limit` |
| `context <topics...>` | Smart fetch of multiple topics merged into one response |
| `list` | List all atoms with grouping and filtering |
| `health` | Diagnostics: broken refs, duplicates, orphans |
| `stats` | Database statistics |
| `sessions` | List indexed sessions (paginated) |
| `watch` | Watch directories for changes and re-index automatically |
| `backfill` | Extract memories from past sessions; flags: `--project`, `--min-messages`, `--limit`, `--since`, `--force`, `--dry-run` |

---

## REST API (selected)

Base URL: `http://localhost:3210`

- **Recall / capture** — `POST /api/recall`, `POST /api/reflect`
- **Memories** — `GET/PUT/DELETE /api/memories[/:id]`, `POST /api/memories/:id/{review,verify,feedback}`
- **Lifecycle** — `POST /api/consolidate`
- **Sessions** — `GET /api/sessions` (paginated), `GET /api/sessions/search?q=`, `GET /api/sessions/:id/messages`
- **Knowledge** — `GET /api/search`, `/api/agents`, `/api/skills`, `/api/plans`
- **Health** — `GET /api/stats`, `GET /api/diagnostics`
