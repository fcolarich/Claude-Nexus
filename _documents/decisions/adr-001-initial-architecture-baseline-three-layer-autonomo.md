---
id: ADR-001
title: Initial architecture baseline: three-layer autonomous memory engine
type: adr
date: 2025-01-01
status: accepted
supersedes: null
tags: []
---

**Decision:** Claude Nexus v2 is structured as three cooperating layers: (1) a capture pipeline (`src/capture/`) driven by Claude Code hooks that reads session transcripts, extracts typed memories via Haiku 4.5, and writes them to a SQLite `memories` table; (2) a recall layer (`src/core/recall.ts`) that ranks memories by decay-adjusted confidence × help-rate and injects them at session start via the `SessionStart` hook; (3) a v1 atom indexer (`src/indexer/`) retained as a read-only mirror of `~/.claude/` knowledge files. The MCP server (`src/mcp/server.ts`), Express REST API (`src/web/server.ts`), Svelte 5 dashboard, and CLI all sit atop the same SQLite DB. Delivery is via a `claude-nexus` plugin in the local marketplace — `.mcp.json` and `hooks/hooks.json` auto-register with Claude Code.

**Alternatives considered:**
- File-only store (v1): markdown files as system of record — discarded for v2 because DB enables decay scoring, FTS, vector search, and dedup that files cannot.
- External vector DB (Milvus, Qdrant): rejected — sqlite-vec keeps the stack zero-dependency and the corpus is small enough (< 50k atoms) that in-process is sufficient.
- Tauri desktop app (removed in v2): replaced by a plain browser SPA served by Express, eliminating native build complexity.

**Reason:** SQLite as system of record provides ACID writes, FTS5 full-text search, sqlite-vec vector similarity, and schema migrations in a single embedded file. The capture pipeline is decoupled from the web server — hooks spawn `dist/capture/runner.js` detached, so capture never blocks a session. The three-layer separation (capture / recall / indexer) makes each subsystem independently testable and replaceable.
