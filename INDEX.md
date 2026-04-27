# Claude Nexus — Index

> **Purpose:** Navigation index for the Claude Nexus codebase.
> A Zettelkasten-style knowledge hub for Claude Code: MCP server, REST API, CLI, and Svelte web dashboard.
>
> **Parent project:** `C:\Fran\LLM_Workflow_Optimization\` — architecture decisions and usage patterns live there.
> **Workflow doc:** `Multi-Agent AI Pipeline/agent-memory.md` — how Claude Nexus fits into the pipeline.

---

## What Claude Nexus Is

Indexes all Claude Code knowledge (memory files, agents, skills, plans, JSONL session transcripts, and Cowork desktop-app sessions)
into a unified SQLite+FTS5 database at `~/.claude-nexus/nexus.db`. Exposes that knowledge via:

- **12 MCP tools** — for use inside Claude Code sessions
- **REST API** (Express 5.x, port 3210) — for the web dashboard and external tooling
- **CLI** (Commander.js) — mirrors MCP tools for terminal use
- **Svelte 5 SPA** — web dashboard at `http://localhost:3210`

---

## Key Files

| File | Purpose |
|------|---------|
| `README.md` | Quick start, all 12 MCP tools, full REST API reference, architecture overview |
| `ARCHITECTURE.md` | Backend routes, DB schema (atoms/atom_links/sessions/diagnostics/FTS5), indexer, frontend routing, MCP server details, key patterns |
| `skills/claude-nexus/SKILL.md` | Agent skill for using Claude Nexus from inside a Claude Code session — describes when and how to use each tool |
| `package.json` | Entry points: `npm run dev:api`, `npm run dev:frontend`, `npm run build` |

---

## MCP Tools (12)

| Tool | What it does |
|------|-------------|
| `nexus_search` | Full-text search (BM25 via FTS5) across all Claude knowledge |
| `nexus_context` | **Primary tool.** Multi-topic smart fetch — one call replaces reading multiple memory files |
| `nexus_shared` | Get all global/shared knowledge atoms (call at session start) |
| `nexus_project` | Get all atoms for a specific project |
| `nexus_sessions` | List sessions with status, project, branch, message count |
| `nexus_tasks` | List task atoms with dependency resolution (`status=ready` for unblocked only) |
| `nexus_task_update` | Update task status; optionally file a new task |
| `nexus_tasks_create` | Batch-create multiple task atoms in one call |
| `nexus_remember` | Store a new knowledge or task atom |
| `nexus_health` | Diagnostics: broken refs, duplicates, orphan atoms, missing frontmatter |
| `nexus_stats` | Atom/link/session counts by type, scope, and project |
| `nexus_reindex` | Force full re-index of all Claude knowledge files |

**Tool verdicts (Tool Analysis v1.1.0):** KEEP+IMPROVE
- Pending: add `sqlite-vec` for hybrid search (currently FTS5 BM25 only)
- Pending: document FTS5 + Node.js v23 compatibility risk

---

## Source Layout

```
claude-nexus/
├── src/
│   ├── core/         DB connection, search, shared types
│   ├── web/          Express 5.x API server + session monitor
│   ├── frontend/     Svelte 5 SPA (views, stores, api client)
│   ├── indexer/      Filesystem scanner, parser, watcher
│   ├── mcp/          MCP server (stdio, 12 tools)
│   └── cli/          CLI entry point (Commander.js)
├── skills/claude-nexus/SKILL.md   Agent skill for in-session use
├── ARCHITECTURE.md
└── README.md
```

---

## MCP Setup

Add to `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "claude-nexus": {
      "command": "npx",
      "args": ["tsx", "C:\\Fran\\claude-nexus\\src\\mcp\\server.ts"]
    }
  }
}
```

---

## Running Locally

```bash
cd C:\Fran\claude-nexus
npm install

# Index all Claude data
npx tsx src/cli/index.ts index

# Start API + dashboard
npm run dev:api       # Express on port 3210
npm run dev:frontend  # Vite dev server

# Start the MCP server (for Claude Code)
npx tsx src/mcp/server.ts
```

---

## Key Architecture Facts

- **DB engine:** `better-sqlite3`, WAL mode, foreign keys enabled
- **Atom types:** `memory`, `agent`, `skill`, `plan`, `feedback`, `reference`, `project_note`, `architecture`, `task`
- **Scopes:** `global`, `shared`, `project`
- **FTS5:** Porter tokenizer + unicode61; snippet with `<mark>` tags; BM25 ranking
- **Re-index cycle:** every 60s in the API server; session status refreshed every 10s
- **File lifecycle:** Write `.md` to disk → indexer picks up on next cycle; delete removes from DB with CASCADE
- **Project scope:** derived from `atoms.project` or `sessions.project`; no separate projects table
- **Cowork sessions:** indexed from `%LOCALAPPDATA%\Packages\Claude_*\...\local-agent-mode-sessions\**\audit.jsonl`; project derived from `userSelectedFolders[0]` in the companion `.json` sibling; stored with `is_cowork=1`, `workspace_id`, `participant_id` columns

---

## Workflow Integration

From `Multi-Agent AI Pipeline/agent-memory.md`:
- `nexus_shared` at session start (loads global preferences + cross-project patterns)
- `nexus_context` for multi-topic retrieval during sessions
- `nexus_remember` at session end via `Stop`/`SessionEnd` hooks (auto-capture)
- `nexus_health` periodically to detect broken refs and duplicates
- Session bookend pattern: `nexus_context` at start, `nexus_remember` at end

Claude Nexus hook scripts (`nexus-capture.sh`, `nexus-load.sh`) are documented in
`Multi-Agent AI Pipeline/pipeline-observability.md`.
