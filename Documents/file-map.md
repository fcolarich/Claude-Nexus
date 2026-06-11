# Claude Nexus — File Map

Short summary of the important files and folders in this project, so an agent can navigate without scanning everything.
Maintained via the `update-file-map` skill.

## Entry points

| File | Role |
|------|------|
| `src/mcp/server.ts` | MCP server — 20 tools exposed over stdio transport |
| `src/web/server.ts` | Express REST API server, port 3210; serves built dashboard from dist-frontend/ |
| `src/cli/index.ts` | CLI entry point — index, search, inspect from terminal |
| `hooks/hooks.json` | Claude Code hook manifest — wires SessionStart (recall) and Stop/PreCompact/SessionEnd (capture) |

## Key files

| File | Role |
|------|------|
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

## Key folders

| Folder | Role |
|--------|------|
| `src/capture/` | All capture-side modules: transcript reading, extraction, reflector, export, load-runner |
| `src/core/` | Shared core: database, embeddings, recall, decay, consolidation, config, types, links |
| `src/mcp/` | MCP server and tool implementations |
| `src/web/` | Express REST API and route handlers |
| `src/frontend/` | Svelte 5 SPA dashboard — Memories, Review, Sessions, Search, Tasks, Agents, Skills views |
| `src/cli/` | CLI commands: index, search, inspect, backfill |
| `src/indexer/` | Knowledge file scanner and parser — indexes agents, skills, plans, tasks, notes from ~/.claude/ |
| `hooks/` | Claude Code hook scripts and hooks.json manifest |
| `dist/` | Compiled JS output from tsc — what hooks and MCP server actually run |
