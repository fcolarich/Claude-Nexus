# Claude Nexus — File Map

Short summary of the important files and folders in this project, so an agent can navigate without scanning everything.
Maintained via the `update-file-map` skill.

## Entry points

| File | Role |
|------|------|
| `src/mcp/server.ts` | MCP server — 18 tools exposed over stdio transport (knowledge, recall, search, project/session management) |
| `src/web/server.ts` | Express REST API server, port 3210; serves built dashboard from dist-frontend/ |
| `src/cli/index.ts` | CLI entry point — index, search, context, list, health, stats, sessions, watch, backfill, prune-narration, migrate-projects |
| `hooks/hooks.json` | Claude Code hook manifest — wires UserPromptSubmit (recall) and Stop/PreCompact/SessionEnd (capture) |

## Key files

| File | Role |
|------|------|
| `src/core/database.ts` | SQLite init, migrations, schema_version management |
| `src/core/recall.ts` | Memory retrieval — bulk decay-ranked recall (recallMemories, for MCP/web) + prompt-driven semantic recall (recallByQuery) |
| `src/core/embeddings.ts` | Embedding generation via Ollama mxbai-embed-large |
| `src/core/reranker.ts` | Cross-encoder reranking client for the local-reranker HTTP daemon (jina-reranker-v2-base-multilingual); wired into recallByQuery's KNN floor (ADR-012) |
| `src/core/config.ts` | Reads extraction_models.yaml; provides runtime config with sane defaults |
| `src/core/project-root.ts` | Project identity resolution — `resolveGitProjectRoot()` (git-common-dir lookup, collapses worktrees onto main checkout) composed with `cwdToProjectSlug()` via `resolveProjectSlug()`; the one function every live-cwd call site uses (ADR-013) |
| `src/core/governance.ts` | consolidateMemories() phases 4-5: `governByHelpRate` (confidence demote/reinforce by observed help-rate) and `detectContradictions` (heuristic pre-filter + bounded Haiku confirmation, surfacing-only via `diagnostics` rows, gated behind DDR-005) |
| `src/capture/reflector.ts` | Background capture pipeline — reads new transcript lines, calls Haiku, dedup-merges memories |
| `src/capture/extract.ts` | Haiku-based memory extraction from transcript windows |
| `src/capture/export.ts` | Exports memories as markdown mirror files; prunes stale project export buckets with no live memories |
| `src/capture/project-migrate.ts` | Merges project buckets fragmented by pre-fix slug bugs or subdirectory-per-project sessions onto their git-root-resolved canonical slug; dedupes via consolidateMemories, re-exports (ADR-013) |
| `src/capture/prompt-runner.ts` | UserPromptSubmit hook — embeds prompt, injects relevance-floored recall (top 3-5, per-session dedup) |
| `extraction_models.yaml` | Runtime config: embedding model, extraction model, recall budget, capture thresholds |
| `package.json` | Project manifest, scripts, dependencies |

## Key folders

| Folder | Role |
|--------|------|
| `src/capture/` | All capture-side modules: transcript reading, extraction, reflector, export, prompt-runner |
| `src/core/` | Shared core: database, embeddings, recall, decay, consolidation, config, types, links |
| `src/mcp/` | MCP server and tool implementations |
| `src/web/` | Express REST API and route handlers |
| `src/frontend/` | Svelte 5 SPA dashboard — Dashboard, Memories, Review, Sessions, Search, Plans, Agents, Skills views |
| `src/cli/` | CLI commands: index, search, context, list, health, stats, sessions, watch, backfill, prune-narration, migrate-projects |
| `src/indexer/` | Knowledge file scanner and parser — indexes agents, skills, plans, notes from ~/.claude/ |
| `hooks/` | Claude Code hook scripts and hooks.json manifest |
| `dist/` | Compiled JS output from tsc — what hooks and MCP server actually run |
