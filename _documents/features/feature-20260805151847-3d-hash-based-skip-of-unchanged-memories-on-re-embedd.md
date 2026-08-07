---
id: FEAT-20260805151847-3d
title: Hash-based skip of unchanged memories on re-embedding/reindex passes
status: planned
date: 2026-08-05
links: ["../../LLM_Workflow_Optimization/_documents/proposals/retrieval-rag/PROP-20260803-210119-sha256-semantic-cache-incremental-rebuild.md"]
tags: ["performance", "embeddings"]
---

Cache embeddings by a content hash (SHA-256) of the memory body so nexus_reindex and similar bulk passes only re-embed memories whose content actually changed, instead of re-embedding the full corpus every time.
