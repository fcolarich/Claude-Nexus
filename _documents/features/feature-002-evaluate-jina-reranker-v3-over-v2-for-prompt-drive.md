---
id: FEAT-002
title: Evaluate jina-reranker-v3 over v2 for prompt-driven recall
status: planned
date: 2026-07-26
links: ["ADR-012"]
tags: ["recall", "reranker", "search"]
---

src/core/reranker.ts is pinned to jina-reranker-v2-base-multilingual and reranker.enabled is already true by default in extraction_models.yaml (ADR-012), so the enable-by-default recommendation from the improvements synthesis (item 4) is already satisfied. The remaining open piece is evaluating jina-reranker-v3 - a newer, smaller, stronger listwise model (BEIR 61.94 at 0.6B params per the synthesis KB citation ATOM-500) - as a replacement for the currently-pinned v2 model.
