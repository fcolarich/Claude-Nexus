---
id: FEAT-20260805151847-68
title: Tunable embedding/text weight for hybrid search fusion
status: planned
date: 2026-08-05
links: ["../../LLM_Workflow_Optimization/_documents/proposals/retrieval-rag/PROP-20260804-145938-hybrid-search-weight-tuning-embedding-weight-text-weight.md", "ADR-003"]
tags: ["recall", "needs-research"]
---

Needs research: implementation approach not yet decided — requires evaluating whether nexus's fixed RRF_K=60 fusion (ADR-003) should become a tunable embedding_weight/text_weight ratio instead, and whether that improves recall quality enough to justify the added config surface.
