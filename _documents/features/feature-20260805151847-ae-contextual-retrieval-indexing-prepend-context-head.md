---
id: FEAT-20260805151847-ae
title: Contextual retrieval indexing: prepend context header before embedding memory bodies
status: planned
date: 2026-08-05
links: ["../../LLM_Workflow_Optimization/_documents/proposals/retrieval-rag/PROP-20260803-210111-contextual-retrieval-indexing.md", "FEAT-009", "ADR-012"]
tags: ["recall", "embeddings"]
---

Prepend a short context header (project, memory_type, decay_class, related topic) to each memory body before embedding, mirroring Anthropic's contextual retrieval technique. Cited results elsewhere show 35% fewer retrieval failures alone, 49% combined with BM25, 67% combined with reranking — nexus already has BM25+RRF (FEAT-009) and reranking (ADR-012), so only the context-prepend step is missing.
