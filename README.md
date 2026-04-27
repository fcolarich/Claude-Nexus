# Claude Nexus

A Zettelkasten-style knowledge hub for Claude Code with three layers:

- **CLI** — index, search, and inspect your Claude knowledge from the terminal
- **Web dashboard** — Svelte SPA (served by an Express API) with views for Sessions, Memories, Search, Plans, Tasks, Agents, and Skills
- **MCP server** — 12 tools that let Claude Code agents query and write knowledge without leaving a conversation

**Database:** SQLite + FTS5 at `~/.claude-nexus/nexus.db`

---

## Quick Start

```bash
cd C:\Fran\claude-nexus
npm install

# Index all Claude data
npx tsx src/cli/index.ts index

# Search across all projects
npx tsx src/cli/index.ts search "WebGL bridge"

# Smart fetch: merge multiple topics into one response
npx tsx src/cli/index.ts context "ECS architecture" "coding preferences"

# Check health (broken refs, orphans, missing frontmatter)
npx tsx src/cli/index.ts health

# List all atoms
npx tsx src/cli/index.ts list

# Show statistics
npx tsx src/cli/index.ts stats

# List sessions
npx tsx src/cli/index.ts sessions

# Watch for changes (live re-indexing)
npx tsx src/cli/index.ts watch
```

---

## Developer Commands

| Command | Purpose |
|---------|---------|
| `npm run dev:api` | Start Express API server on port 3210 |
| `npm run dev:frontend` | Start Vite dev server for the Svelte SPA |
| `npm run build:frontend` | Production build of the frontend → `dist-frontend/` |
| `npm run dev` | API + Tauri desktop app concurrently |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm run test` | Run Vitest test suite once |
| `npm run test:watch` | Run Vitest in watch mode |

Stop any server: `Ctrl+C` in the terminal running it.

---

## MCP Server Setup

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

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `nexus_search` | Cross-project full-text search across all Claude knowledge |
| `nexus_context` | Smart fetch: request multiple topics, receive one merged response |
| `nexus_shared` | Get all global/shared knowledge atoms (call at session start) |
| `nexus_project` | Get all knowledge atoms for a specific project |
| `nexus_sessions` | List sessions with status, project, branch, and message count |
| `nexus_tasks` | List task atoms with dependency resolution (`status=ready` for unblocked only) |
| `nexus_task_update` | Update a task status on disk and optionally file a new task |
| `nexus_remember` | Store a new knowledge atom or task atom |
| `nexus_tasks_create` | Batch-create multiple task atoms in one call |
| `nexus_health` | Diagnostics: broken refs, duplicates, orphan atoms, missing frontmatter |
| `nexus_stats` | Atom/link/session counts by type, scope, and project |
| `nexus_reindex` | Force full re-index of all Claude knowledge files |

---

## REST API

Base URL: `http://localhost:3210`

### Dashboard & Stats

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/dashboard` | Overview: projects, sessions, memory stats |
| `GET` | `/api/stats` | Atom counts by type/scope/project |
| `GET` | `/api/diagnostics` | Knowledge graph diagnostics |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions` | List sessions (filter: `project`, `status`) |
| `GET` | `/api/sessions/:id` | Get session details |
| `GET` | `/api/sessions/:id/messages` | Full conversation with tool use blocks |
| `GET` | `/api/sessions/:id/references` | Atoms that reference this session |
| `PATCH` | `/api/sessions/:id` | Rename session |
| `DELETE` | `/api/sessions/:id` | Delete session |

### Memories / Atoms

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/memories` | List atoms (filter: `project`, `type`, `scope`) |
| `GET` | `/api/memories/:id` | Get atom with links |
| `GET` | `/api/atoms/:id/raw` | Raw file body (no frontmatter) |
| `PUT` | `/api/atoms/:id` | Update atom body |
| `DELETE` | `/api/atoms/:id` | Delete atom |
| `POST` | `/api/atoms/create-memory` | Create a new memory file |

### Plans / Agents / Skills

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/plans` | List plan atoms |
| `GET` | `/api/agents` | List agent definition atoms |
| `GET` | `/api/skills` | List skill definition atoms |

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks` | List tasks with dependency resolution (filter: `status`, `priority`) |
| `POST` | `/api/tasks` | Create a new task atom |
| `PATCH` | `/api/tasks/:id` | Update task status |

### Search & Projects

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/search` | Full-text search (params: `q`, `type`, `project`, `limit`) |
| `GET` | `/api/projects` | List all distinct projects |
| `DELETE` | `/api/projects/:name` | Delete entire project and its files |

---

## Architecture

| Layer | Detail |
|-------|--------|
| **Database** | SQLite + FTS5 at `~/.claude-nexus/nexus.db`; tables for atoms, links, sessions, diagnostics |
| **Indexer** | Scans `~/.claude/` for agents, skills, plans, per-project memory files, and JSONL session transcripts; also indexes Cowork desktop-app `audit.jsonl` sessions from the Windows Claude package directory |
| **Parser** | Extracts YAML frontmatter, splits multi-section files, detects inter-atom links |
| **Search** | BM25 ranking via FTS5, scoped by project / type / scope |
| **Backend** | Express 5.x on port 3210; 60 s re-index cycle, 10 s session status refresh |
| **Frontend** | Svelte 5 SPA; client-side routing via stores; views: Dashboard, Sessions, Memories, Search, Plans, Tasks, Agents, Skills |
| **MCP Server** | Stdio transport; 12 tools returning merged markdown responses |
| **CLI** | Commander.js with chalk output; mirrors MCP tools for terminal use |
