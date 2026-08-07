---
id: FEAT-20260805151847-4c
title: Reorder-then-compress: place highest-relevance memories at context boundaries
status: planned
date: 2026-08-05
links: ["../../LLM_Workflow_Optimization/_documents/proposals/retrieval-rag/PROP-20260803-210121-reorder-then-compress.md", "FEAT-008"]
tags: ["recall"]
---

When assembling the injected recall context, place the highest-relevance memories at the first/last positions (not buried in the middle) before applying the existing full-body-to-titles-only degradation (FEAT-008), to mitigate 'lost in the middle' attention degradation on longer injected context.
