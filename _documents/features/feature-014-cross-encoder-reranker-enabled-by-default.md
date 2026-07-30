---
id: FEAT-014
title: Cross-encoder reranker enabled by default
status: implemented
date: 2026-07-26
links: []
tags: ["memory", "reranking", "knowledge-vault"]
---

extraction_models.yaml sets reranker.enabled: true by default (jina-reranker-v2-base-multilingual, local HTTP, threshold 0.2), wired into recallByQuery's KNN floor per ADR-012. Matches the Two-Stage Retrieval Pipeline knowledge-vault atom (+8% hit rate, +33.7% MRR over cosine-only retrieval) -- the improvement synthesis initially found this disabled by default and recommended enabling it; verified during doc-sync that it is already on.
