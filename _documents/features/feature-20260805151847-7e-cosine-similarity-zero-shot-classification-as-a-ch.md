---
id: FEAT-20260805151847-7e
title: Cosine-similarity zero-shot classification as a cheaper alternative to Haiku calls
status: planned
date: 2026-08-05
links: ["../../LLM_Workflow_Optimization/_documents/proposals/retrieval-rag/PROP-20260804-145947-zero-shot-classification-via-cosine-similarity.md"]
tags: ["governance", "cost", "needs-research"]
---

Needs research: implementation approach not yet decided — requires evaluating whether cosine similarity against a small set of labeled anchor embeddings can replace Haiku-based classification calls (e.g. origin classification, governance checks) for cost/latency wins where full LLM judgment isn't needed.
