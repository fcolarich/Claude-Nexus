# Claude Nexus — File Map

**Source**: _documents/file-map.md

## Summary

Claude Nexus is organized into entry points, core services, capture pipeline, and operational scripts. The three main entry points are the MCP server (`src/mcp/server.ts`) exposing 20 tools over stdio, an Express REST API server on port 3210 serving a Svelte dashboard (`src/web/server.ts`), and a CLI (`src/cli/index.ts`) supporting index, search, context, list, health, stats, sessions, watch, backfill, prune-narration, and migrate-projects commands. The Claude Code hook manifest (`hooks/hooks.json`) wires UserPromptSubmit for recall and Stop/PreCompact/SessionEnd for capture.

Core services handle database setup and migrations, memory retrieval via decay-ranked bulk recall and semantic recall by query, embedding generation via Ollama, reranking via a local jina-reranker HTTP daemon, runtime config from extraction_models.yaml, and project identity resolution that collapses git worktrees. Governance applies help-rate confidence signals and detects contradictions. Search fuses FTS5 and vector retrieval via Reciprocal Rank Fusion. Capture pipeline reads transcript lines, extracts memories via Haiku, deduplicates, and exports markdown mirrors. The origin classifier gates capture based on denylist rules, environment flags, and transcript readability. Project migration consolidates fragmented buckets resolved to canonical git-root slugs.

The dashboard frontend (Svelte 5) provides Dashboard, Memories, Review, Sessions, Search, Plans, Agents, and Skills views. Operational scripts support distill-sweep (chunk-by-chunk memory merging with GPU memory management), pre-sweep snapshots with rollback anchors, merge-model validation, audit-merges for identifier loss and coverage signals, origin-based retroactive purge, and distill rollback. Compiled dist/ output is what hooks and the MCP server actually execute.

## Key facts

- Entry points: MCP server (stdio, 20 tools), Express API (port 3210), CLI, Claude Code hook manifest
- Core services: database, recall (bulk decay-ranked + semantic), embeddings (Ollama mxbai-embed-large), reranking (jina-reranker-v2), config, project resolution, governance, search (FTS5 + sqlite-vec via RRF)
- Capture: transcript reading, Haiku extraction, dedup/merge, markdown export, origin classifier with denylist/flag/readability gating
- Project migration: consolidates fragmented buckets onto canonical git-root slug (ADR-013), dedupes via consolidateMemories
- Governance: help-rate demotion/reinforcement (DDR-006), contradiction detection (DDR-005)
- Frontend: Svelte 5 SPA with 8 views (Dashboard, Memories, Review, Sessions, Search, Plans, Agents, Skills)
- Distill tooling: sweep with GPU memory management, pre-sweep snapshots, merge-model validation, identifier-loss/coverage audit, retroactive purge, rollback
- Compiled dist/ is the runtime artifact executed by hooks and MCP server

## Open questions

- What are the 20 MCP tools in detail? (NOTE-002 referenced but not included)
- What specific architectural decisions underpin project resolution (ADR-013), reranking (ADR-012), and origin gating (ADR-20260802200851-8e)?
- What design rationale drives governance's help-rate signal (DDR-006) and contradiction detection (DDR-005)?
- How does the local-reranker HTTP daemon lifecycle integrate with the MCP server?
- What are the tradeoffs in identifier-loss detection vs. coverage-based audit for merge quality?
