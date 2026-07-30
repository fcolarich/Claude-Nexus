---
id: FEAT-004
title: Structural/graph memory (long-term, not recommended near-term)
status: planned
date: 2026-07-26
links: []
tags: ["long-term", "low-priority", "not-recommended-near-term", "architecture"]
---

Long-term option raised by external research (Zep, Cognee) suggesting graph/structural memory representations can outperform pure vector storage on some benchmarks, versus Nexus current flat-relational SQLite design (WAL + FTS5 + sqlite-vec, typed memory_type/decay_class/scope/promotion_target fields). The improvements synthesis explicitly does NOT recommend this as a near-term change: the flat design matches the projects stated flat-codebase/minimal-abstraction philosophy and already supports typed relationships without a graph engine. Recorded here as a deferred, low-priority option to revisit only if a concrete retrieval-quality problem emerges that the current schema cannot address - not an active work item. Sourced from claude-nexus-improvements-synthesis.md item 9.
