---
id: FEAT-20260805151847-8e
title: Query rewriting before recallByQuery embedding
status: planned
date: 2026-08-05
links: ["../../LLM_Workflow_Optimization/_documents/proposals/retrieval-rag/PROP-20260804-145940-query-rewriting-rewrite-query-true.md", "ADR-009"]
tags: ["recall"]
---

Auto-rewrite the user's prompt into a more retrieval-friendly query before it is embedded for recallByQuery (prompt-driven semantic recall, ADR-009), the way OpenAI's retrieval API's rewrite_query option does.
