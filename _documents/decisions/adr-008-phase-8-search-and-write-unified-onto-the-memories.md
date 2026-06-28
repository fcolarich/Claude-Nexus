---
id: ADR-008
title: Phase 8: search and write unified onto the memories store
type: adr
date: 2026-06-26
status: accepted
supersedes: null
tags: ["memories", "search", "embeddings", "nexus_search", "nexus_remember", "phase-8"]
---

**Decision:** Both read and write paths unified onto the memories store: (1) src/core/search.ts gained searchMemories, hybridSearchMemories (FTS5 + sqlite-vec RRF), and fetchMemoryContext. (2) nexus_search fires hybridSearch (atoms) and hybridSearchMemories (memories) in parallel, rendering two labelled sections. (3) nexus_context calls both fetchMemoryContext and fetchContext, merging results. (4) nexus_remember non-task path writes directly to memories via insertMemory (auto-approved, confidence 0.85, decay_class derived from memory_type) instead of writing to the atoms store. Task atoms still use the atoms file path. Legacy atom_type values map to memory_type via ATOM_TYPE_TO_MEMORY_TYPE. (5) src/core/embeddings.ts gained ensureEmbeddingModelReady() — a 60s-timeout warmup call run once before any bulk embedding pass. generateEmbedding retries once on HTTP 500 with a 3s wait. Both embedUnindexedMemories and embedUnindexed call the warmup before their loops and bail early if unavailable.

**Alternatives:** Keep atoms and memories as separate silos (v2 original): memories captured by the Reflector were recallable via nexus_recall but invisible to nexus_search — correct but creates a confusing split where capture and interactive paths are disjoint. Write nexus_remember to atoms only: preserves old behavior but means user-written memories never benefit from decay scoring or the memories ranking pipeline. Merge atoms table into memories entirely: too invasive for Phase 8; the atoms store still serves the indexer and project-doc paths.

**Reason:** After v2 launched, nexus_search and nexus_context operated exclusively on the atoms table while the autonomous capture pipeline wrote to memories. A memory captured by the Reflector was recallable via nexus_recall but invisible to nexus_search — the two stores were siloed. Unifying read paths (search, context) onto both stores and write path (nexus_remember) onto memories closes this gap: captured memories are now findable by nexus_search and nexus_context, and manual nexus_remember calls write into the same ranked, decay-scored store that recall uses. Embedding startup no longer floods stderr with hundreds of 500 errors when Ollama is cold.
