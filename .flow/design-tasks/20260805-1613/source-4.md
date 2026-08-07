# Structural/graph memory (long-term, not recommended near-term)

**Source**: _documents/features/feature-004-structuralgraph-memory-long-term-not-recommended-n.md

## Summary

The document discusses a long-term architectural option inspired by external research (Zep, Cognee) proposing graph or structural memory representations as alternatives to Nexus's current flat-relational SQLite design. The current architecture uses WAL, FTS5, sqlite-vec, and typed fields for memory_type, decay_class, scope, and promotion_target. While such graph approaches are claimed to outperform pure vector storage on some benchmarks, the improvements synthesis explicitly advises against pursuing this near-term. The flat architecture aligns with the project's stated philosophy of minimal abstraction and already provides typed relationship support without requiring a graph engine. The feature is marked as deferred and low-priority, to be reconsidered only if a concrete retrieval-quality problem emerges that the existing schema cannot address.

## Key facts

- External research (Zep, Cognee) has proposed graph/structural memory representations as an alternative approach
- Graph-based approaches are claimed to outperform pure vector storage on some benchmarks
- Nexus currently uses flat-relational SQLite with WAL, FTS5, sqlite-vec, and typed fields
- The improvements synthesis explicitly recommends against near-term implementation
- The flat design aligns with the project's flat-codebase/minimal-abstraction philosophy
- The current schema already supports typed relationships without requiring a graph engine
- This feature is recorded as deferred and low-priority

## Open questions

- What specific retrieval-quality problems would justify reconsidering a graph-based approach?
- Which concrete benchmarks or performance data from Zep/Cognee research demonstrated improvements, and how relevant are they to Nexus's actual use cases?
