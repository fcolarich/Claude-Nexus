---
id: ADR-004
title: nexus_crossref: runtime hybrid search as a distinct tool from passive auto-linking
type: adr
date: 2025-01-01
status: accepted
supersedes: null
tags: []
---

**Decision:** `nexus_crossref` is a runtime MCP tool (user/agent-initiated) that runs the same hybrid KNN + BM25 RRF retrieval as `linkAtom`/`linkMemory`, but returns ranked results instead of writing links. This is architecturally distinct from the passive auto-linking in ADR-003: auto-linking fires once after each write and persists edges to `atom_links`/`memory_links`; `nexus_crossref` is ephemeral, fires on demand, and returns both atoms and memories in a unified ranked list. The tool accepts a query string and optional project/scope filters and returns results above a configurable threshold. It does not mutate the DB.

**Alternatives considered:**
- Exposing links table directly: less useful — the caller wants ranked candidates, not raw edges.
- Merging into `nexus_search`: `nexus_search` is FTS-primary with optional vector; `nexus_crossref` is hybrid-first and optimized for finding related content around a known topic.

**Reason:** Separating read-path cross-ref from write-path linking keeps both paths simple and independently testable. The tool is especially useful for "what else do I know about X" queries during sessions where the auto-linking pass hasn't yet run (e.g. newly captured memories before the next consolidation).
