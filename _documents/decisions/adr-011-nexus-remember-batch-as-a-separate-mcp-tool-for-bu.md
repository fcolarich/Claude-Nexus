---
id: ADR-011
title: nexus_remember_batch as a separate MCP tool for bulk memory writes
type: adr
date: 2026-07-02
status: accepted
supersedes: null
tags: ["mcp", "memories", "batch", "api-design", "zod"]
---

**Decision:** Add a new MCP tool nexus_remember_batch that writes 1-50 memories in one call, rather than overloading the existing single-item nexus_remember. Logic lives in a service helper rememberBatch(db, items) in src/core/memories.ts: all inserts run inside one db.transaction() (single fsync vs N) with a per-item try/catch so one bad item is recorded as status error and does not abort the batch. It returns per-item results with three statuses - written, duplicate, error - reusing insertMemory's content-addressed dedup to distinguish written from duplicate. The tool schema takes a memories array (min 1, max 50) of per-item fields plus top-level default fields; the effective value per item is item ?? top-level-default ?? builtin, so a shared scope/memory_type is set once. Embedding fires best-effort after commit, outside the transaction, for each written id. nexus_remember is left byte-for-byte unchanged.

**Alternatives:** Overload nexus_remember by making title/content/scope optional and adding an optional memories array. Rejected: zod cannot express 'these fields are optional only when a memories array is present', so overloading would sacrifice the schema-strictness validation guarantee and break parity with the prior batch precedent (nexus_tasks_create was also a separate tool). Also considered inlining the batch loop directly in the MCP handler; rejected because the project keeps controllers thin and logic in services, and a helper is unit-testable without starting the MCP server.

**Reason:** A separate tool preserves nexus_remember's strict schema and zero migration risk while collapsing N sequential MCP round-trips (e.g. 16 recipe pointers) into one transactional call. Wrapping inserts in a single transaction with per-item error isolation gives atomic durability with best-effort partial success; treating the batch as best-effort is safe because the on-disk doc file is the authoritative record and embeddings are regenerable via nexus_reindex.
