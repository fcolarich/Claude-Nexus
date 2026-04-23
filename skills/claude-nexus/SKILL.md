---
name: claude-nexus
description: Cross-project knowledge retrieval via Claude Nexus MCP. Use when you need context from other projects, user preferences, shared patterns, or session awareness. Replaces reading multiple memory files with one targeted tool call.
---

# Claude Nexus — Cross-Project Knowledge Graph

Claude Nexus indexes all Claude Code knowledge (memories, agents, skills, plans) into a unified zettelkasten with full-text search. It is registered as an MCP server and provides tools that return **merged markdown** — one tool call replaces multiple file reads.

## When to Use Nexus

- **Session start**: Call `nexus_shared` to load global/shared knowledge (user preferences, environment, cross-project patterns)
- **Need context from another project**: Call `nexus_context` with topics instead of reading files from `~/.claude/projects/*/memory/`
- **Searching across all knowledge**: Call `nexus_search` with a query — it searches across ALL projects, agents, skills, and plans
- **Understanding a project**: Call `nexus_project` with the project slug to get all its atoms at once
- **Checking session status**: Call `nexus_sessions` to see what other Claude sessions are doing
- **Saving new knowledge**: Call `nexus_remember` to create a persistent atom that survives across sessions
- **Auditing knowledge health**: Call `nexus_health` to find broken references, duplicates, and orphan atoms

## Available MCP Tools

### `nexus_search` — Full-text search
Search across ALL Claude knowledge with FTS5 (BM25 ranking).
```
nexus_search(query: "ECS architecture", project?: "...", type?: "memory", scope?: "global", limit?: 10)
```
Supports FTS5 syntax: AND, OR, NOT, "exact phrases", prefix*.

### `nexus_context` — Smart multi-topic fetch (PRIMARY TOOL)
**This is the most valuable tool.** Request multiple topics, get one merged response.
```
nexus_context(topics: ["ECS architecture", "coding preferences", "WebGL bridge"], project?: "...")
```
Use this instead of reading 3+ memory files. One call, precisely targeted context.

### `nexus_shared` — Global/shared knowledge
Returns all atoms scoped as `global` or `shared` (user preferences, environment info, cross-project patterns).
```
nexus_shared()
```
Call at session start to understand the user's universal context.

### `nexus_project` — All atoms for one project
```
nexus_project(project: "C--Fran-RRDestructible")
```
Returns every atom for that project, merged. Good for onboarding into a project.

### `nexus_sessions` — Session awareness
```
nexus_sessions(project?: "...", status?: "active")
```
See what other sessions are running, waiting for input, or idle.

### `nexus_health` — Knowledge graph diagnostics
```
nexus_health(type?: "broken_reference")
```
Reports: broken references, duplicates, missing frontmatter, orphan atoms, stale entries.

### `nexus_remember` — Create a new knowledge atom
```
nexus_remember(
  title: "Pattern: Service locator in Arch ECS",
  content: "## How it works\n...",
  scope: "shared",
  atom_type: "architecture",
  tags: ["ECS", "Arch", "patterns"],
  project: "C--DCL-unity-explorer-3"
)
```
Creates a markdown file with frontmatter AND indexes it. The atom persists across sessions.
Also accepts `atom_type: "task"` — see Task Tracking section.

### `nexus_tasks` — List tasks with dependency resolution
```
nexus_tasks(project?: "slug", status?: "ready", priority?: 1, include_done?: false)
```
Returns task atoms sorted by priority. `status="ready"` resolves dependency chains server-side.

### `nexus_task_update` — Update task status
```
nexus_task_update(id: "abc123", status: "done", discovered?: "Title of new task found")
```
Updates status on disk, re-indexes, returns updated task. `discovered` creates a linked child task.

### `nexus_stats` — Database overview
```
nexus_stats()
```
Atom counts by type/scope/project, link counts, session counts.

## Atom Scopes

| Scope | Meaning | Example |
|-------|---------|---------|
| `global` | Applies to ALL projects | "User prefers terse responses", "Windows + Git Bash environment" |
| `shared` | Applies to a group of related projects | "Unity/C#/ECS patterns" shared across DCL projects |
| `project` | Specific to one project | "RRDestructible uses pooled mesh fragments" |

## Atom Types

`memory`, `agent`, `skill`, `plan`, `feedback`, `reference`, `project_note`, `architecture`, `task`

## Task Tracking

Nexus handles task state natively. No separate tool needed.

### Session start workflow
1. `nexus_shared()` — load global knowledge context
2. `nexus_tasks(status: "ready")` — see what's unblocked and prioritized

These two calls replace reading AGENTS.md + any task plan files.

### Task tools

| Action | Tool |
|--------|------|
| See ready work | `nexus_tasks(status: "ready")` |
| See all tasks for a project | `nexus_tasks(project: "slug")` |
| Start working on a task | `nexus_task_update(id, status: "in_progress")` |
| Complete a task | `nexus_task_update(id, status: "done")` |
| File a discovered task | `nexus_task_update(id, discovered: "title of new task")` |
| Create a new task | `nexus_remember(atom_type: "task", title: "...", priority: 1, project: "...")` |

### Task atom fields
- `status`: ready | in_progress | blocked | done
- `priority`: 1 (urgent) – 3 (low)
- `blocked_by`: list of atom IDs that must be done first
- `blocks`: list of atom IDs this task unlocks
- `discovered_from`: audit trail — which task surfaced this one

### Dependency resolution
`nexus_tasks(status: "ready")` resolves dependencies server-side. A task only appears
as ready if ALL its `blocked_by` tasks are done. You never need to manually check
dependency chains — the tool handles it.

## Decision Guide

| Situation | Tool to Use |
|-----------|------------|
| Starting a new session | `nexus_shared()` then `nexus_tasks(status: "ready")` |
| See what to work on | `nexus_tasks(status: "ready")` |
| Start a task | `nexus_task_update(id, status: "in_progress")` |
| Complete a task | `nexus_task_update(id, status: "done")` |
| Create a task | `nexus_remember(atom_type: "task", ...)` |
| Need info about a specific topic | `nexus_search(query)` |
| Need multiple topics at once | `nexus_context(topics)` |
| Getting up to speed on a project | `nexus_project(slug)` |
| Learned something worth persisting | `nexus_remember(...)` |
| Checking what other sessions are doing | `nexus_sessions()` |
| Auditing knowledge quality | `nexus_health()` |
| Just saved memory files via Write tool | `nexus_reindex()` — forces immediate re-index |

### `nexus_reindex` — Force re-index
```
nexus_reindex()
```
Triggers a full re-scan of all `.md` files under `~/.claude/`. Call this after saving new memory files via the Write tool so they appear in search immediately.

## Sync Behavior

- **MCP server**: runs a full index on startup (each new Claude session)
- **Web server**: re-indexes every 60 seconds automatically
- **`nexus_remember`**: indexes the new atom immediately after writing
- **Normal Write tool to memory files**: NOT auto-detected by MCP — call `nexus_reindex()` after saving

## Saving Memories: `nexus_remember` vs Write Tool

| Action | Use |
|--------|-----|
| **Creating a new memory** | `nexus_remember(...)` — writes file + indexes in one step |
| **Editing an existing memory file** | Write tool, then `nexus_reindex()` |
| **Updating MEMORY.md index** | Write tool (nexus_remember can't edit the index file) |

**Rule: Always prefer `nexus_remember` for new memories.** It handles file placement, frontmatter, and indexing automatically. Only use the Write tool when you need to edit or update an existing file.

## Key Principle

**One tool call, one merged response.** Never read 5 memory files when `nexus_context(["topic1", "topic2", "topic3"])` gives you everything in one call with zero wasted tokens.
