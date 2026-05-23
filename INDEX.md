# Claude Nexus — Index

> **Purpose:** Navigation index for the Claude Nexus codebase.
> An **autonomous memory engine** for Claude Code: watches sessions, distills durable
> knowledge into typed memories, and injects relevant ones at the start of future sessions.
>
> **Parent project:** `C:\Fran\LLM_Workflow_Optimization\` — architecture decisions live there.

---

## What Claude Nexus Is

v1 was a passive file-indexer. **v2 is an autonomous memory engine.** It:

- **Captures** — hooks fire the Reflector after each session; it reads the transcript,
  extracts typed memories via Haiku, dedup-merges them, and stores them.
- **Recalls** — a SessionStart hook injects the most relevant memories for the project,
  ranked and budgeted to a token cap.
- **Maintains** — memories decay with age, can be reverified, consolidated, and distilled.

It also still indexes Claude knowledge files (agents, skills, plans, tasks) and session
transcripts. Storage: SQLite + FTS5 + sqlite-vec at `~/.claude-nexus/nexus.db`.

Surfaces: **19 MCP tools**, a REST API (Express, port 3210), a CLI, and a Svelte 5
browser dashboard.

---

## Key Files

| File | Purpose |
|------|---------|
| `README.md` | Quick start, how-it-works, MCP tools, setup, architecture overview |
| `ARCHITECTURE.md` | Deep dive — v2 schema, capture/recall/lifecycle pipelines, modules, API |
| `extraction_models.yaml` | Config — embedding model, extraction model/provider, recall budget, capture thresholds |
| `skills/claude-nexus/SKILL.md` | Agent skill — when/how to use each tool from inside a session |
| `hooks/README.md` | The capture/load hooks and how the plugin auto-registers them |

---

## MCP Tools (19)

**Retrieval:** `nexus_recall` (budgeted memory recall) · `nexus_search` · `nexus_context` ·
`nexus_project` · `nexus_shared`
**Capture / lifecycle:** `nexus_remember` · `nexus_verify` · `nexus_feedback` ·
`nexus_consolidate` · `nexus_distill` · `nexus_backfill`
**Tasks:** `nexus_tasks` · `nexus_tasks_create` · `nexus_task_update`
**Ops:** `nexus_sessions` · `nexus_health` · `nexus_stats` · `nexus_reindex` · `nexus_set_init`

---

## Source Layout

```
claude-nexus/
├── src/
│   ├── core/         DB + migrations, memories, recall, decay, consolidate,
│   │                 distill, llm client, embeddings, search, config, types
│   ├── capture/      transcript (Observer), extract (Haiku), reflector,
│   │                 export, runner + load-runner (hook entries), backfill
│   ├── web/          Express API server + session monitor
│   ├── frontend/     Svelte 5 SPA (Memories, Review, Sessions, Search, …)
│   ├── indexer/      Filesystem scanner, parser, session-message FTS
│   ├── mcp/          MCP server (stdio, 19 tools)
│   └── cli/          CLI entry point (Commander.js — incl. `backfill`)
├── hooks/            nexus-capture.mjs (capture) + the load runner
├── extraction_models.yaml
├── ARCHITECTURE.md
└── README.md
```

---

## Setup

Nexus ships as the **`claude-nexus` plugin** in the local marketplace. Enabling the
plugin auto-registers the MCP server (`.mcp.json`) and the capture/recall hooks
(`hooks/hooks.json`) — no manual `settings.json` editing.

```bash
cd C:\Fran\claude-nexus
npm install
npm run build          # required — the hooks + MCP server run from dist/
```

Prerequisites: Node 22+, Ollama with `mxbai-embed-large`, an authenticated `claude` CLI
(`claude login` — the Reflector calls Haiku through the Claude Agent SDK).

---

## Running Locally

```bash
npm run dev            # Express API (3210) + Vite dev server — dashboard in a browser
npx tsx src/cli/index.ts index        # one-off full index
npx tsx src/cli/index.ts backfill --dry-run   # preview retroactive capture
```

---

## Key Architecture Facts

- **Two stores:** `memories` (the v2 autonomous store — typed, confidence-scored,
  decaying) and `atoms` (file-indexed artifacts — agents/skills/plans/tasks).
- **Memory types:** preference · convention · failure · correction · decision · insight ·
  tool_quirk · reference · handoff.
- **Capture loop:** Stop/PreCompact/SessionEnd → Reflector (cursor-tracked, idempotent).
  SessionStart → budgeted recall.
- **Decay:** computed, non-destructive — stored `confidence` is intrinsic; effective
  confidence falls with age per `decay_class`; reverify resets it.
- **Review gate:** low-confidence extractions are `pending` and withheld from recall
  until approved in the dashboard Review view.
- **Migrations:** numbered, via a `schema_version` table.
- **Models:** `mxbai-embed-large` (Ollama) for embeddings; Haiku 4.5 via the Claude
  Agent SDK for extraction. Both configurable in `extraction_models.yaml`.
- **No Tauri** — the dashboard is browser-based.
