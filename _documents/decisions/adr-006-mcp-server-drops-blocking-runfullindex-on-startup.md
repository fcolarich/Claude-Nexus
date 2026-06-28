---
id: ADR-006
title: MCP server drops blocking runFullIndex on startup
type: adr
date: 2026-06-26
status: accepted
supersedes: null
tags: ["mcp", "performance", "startup", "sqlite", "indexing"]
---

**Decision:** MCP server (src/mcp/server.ts) no longer calls runFullIndex at startup. Indexing stays with the web server only. The MCP server opens the DB, runs migrations, and immediately begins serving tool requests.

**Alternatives:** Keep runFullIndex at startup (original behavior) — correct but caused ~33s event-loop block, SQLITE_BUSY contention, and MCP connect handshake timeouts. Deferred indexing on first tool call — adds latency to the first real request. Background thread — Node.js is single-threaded; offloading to a worker_thread adds complexity without fixing the handshake timeout.

**Reason:** runFullIndex ran large synchronous SQLite transactions at MCP server startup, blocking the Node.js event loop for ~33 seconds. This caused SQLITE_BUSY contention and pushed the MCP connect handshake past the client timeout, making the server appear to fail on load. Moving indexing exclusively to the web server (which has a 60s refresh cycle) eliminates the block entirely. MCP tools primarily query memories (always current) not atoms, so a slightly stale atom index between refresh cycles is acceptable. Commit: 3a54d4c (June 19).
