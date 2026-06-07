# Claude Nexus — Claude Instructions

## What This Is

Autonomous memory engine for Claude Code. Watches sessions, distills durable typed memories via Haiku, injects the highest-value ones back at session start. Ships an MCP server, a REST API, a Svelte 5 dashboard, and a CLI.

Give Claude Code persistent cross-session memory without manual note-taking — capture, rank, decay, recall.

## Tech Stack

- **Language:** TypeScript (ESM, Node 22+)
- **Runtime:** Node.js 22+
- **Build:** tsc → dist/
- **Frontend:** Svelte 5 + Vite
- **Database:** SQLite (better-sqlite3) + FTS5 + sqlite-vec
- **Embeddings:** mxbai-embed-large via Ollama
- **Extraction model:** Claude Haiku 4.5 via @anthropic-ai/claude-agent-sdk
- **MCP:** @modelcontextprotocol/sdk (stdio transport)
- **API:** Express 5, port 3210
- **Test:** Vitest

## Reference Documents

Read these before working in their area. They record the *why* — don't contradict them without understanding the rationale first. Load on demand; you don't need all of them in context at once.

| Document | What's in it | Update when… | Skill |
|----------|--------------|--------------|-------|
| [`Documents/architecture.md`](Documents/architecture.md) | Structural/technical decisions (ADRs) — DB schema, migration framework, layer boundaries, link algorithms | A structural or technical decision is made or changed | `add-adr` |
| [`Documents/design.md`](Documents/design.md) | Design decisions (DDRs) — capture/recall pipeline design, API shape, data model choices, naming | A design decision is made or changed | `add-ddr` |
| [`Documents/references.md`](Documents/references.md) | Research, sources, long reference material | You gather external research or sources worth keeping | `add-reference` |
| [`Documents/notes.md`](Documents/notes.md) | Operational notes, reminders, how-to-update | You have a note that fits nowhere else | `add-note` |
| [`Documents/file-map.md`](Documents/file-map.md) | Summary of important files/folders | Files/folders are added, renamed, or repurposed | `update-file-map` |
| [`README.md`](README.md) | Human-facing summary + usage | The project summary or user-facing behaviour changes | `update-claude-readme` |

## Doc-Maintenance Protocol

These docs only stay useful if kept current. After any non-trivial change:

1. **Structural/technical decision?** → append an ADR via `add-adr`. Never edit old ADRs.
2. **Design decision?** → append a DDR via `add-ddr`. A design change usually pairs with an architecture change — update both.
3. **Files/folders moved or added?** → `update-file-map`.
4. **Project summary changed?** → `update-claude-readme` (keeps CLAUDE.md ↔ README.md in sync).
5. **Research / external sources?** → `add-reference`.
6. **Loose note?** → `add-note`.

Or run `/update-project-docs` after a change and let the doc-sync agent route it to the right skills.

## Conventions

- Tabs for indentation throughout
- Flat codebase — minimal folders, minimal abstraction
- Controllers thin, logic in services
- SQLite boolean columns as INTEGER 0/1 (number type in TS)
- Project slugs: lowercase, spaces → hyphens, Windows drive colon → double dash (e.g. C--Fran-project)
- Default new atoms to load_at_init: false
- INSERT ... ON CONFLICT DO UPDATE must include all fields in SET clause
- Smart project resolution: derive slug from cwd, fallback strategies

## Key Files

| File | Role |
|------|------|
| `src/mcp/server.ts` | MCP server — 20 tools exposed over stdio transport |
| `src/web/server.ts` | Express REST API server, port 3210; serves built dashboard from dist-frontend/ |
| `src/cli/index.ts` | CLI entry point — index, search, inspect from terminal |
| `hooks/hooks.json` | Claude Code hook manifest — wires SessionStart (recall) and Stop/PreCompact/SessionEnd (capture) |
| `src/core/database.ts` | SQLite init, migrations, schema_version management |
| `src/core/recall.ts` | Decay-ranked, token-budgeted memory retrieval |
| `src/core/embeddings.ts` | Embedding generation via Ollama mxbai-embed-large |
| `src/core/config.ts` | Reads extraction_models.yaml; provides runtime config with sane defaults |
| `src/capture/reflector.ts` | Background capture pipeline — reads new transcript lines, calls Haiku, dedup-merges memories |
| `src/capture/extract.ts` | Haiku-based memory extraction from transcript windows |
| `src/capture/export.ts` | Exports memories as markdown mirror files |
| `src/capture/load-runner.ts` | Recall hook runner — budgeted inject at session start |
| `extraction_models.yaml` | Runtime config: embedding model, extraction model, recall budget, capture thresholds |
| `package.json` | Project manifest, scripts, dependencies |
