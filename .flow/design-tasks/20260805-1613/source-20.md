# Query rewriting before recallByQuery embedding

**Source**: _documents/features/feature-20260805151847-8e-query-rewriting-before-recallbyquery-embedding.md

## Summary

This feature proposes to automatically rewrite a user's prompt into a more retrieval-friendly query before it is embedded for recallByQuery, which implements prompt-driven semantic recall (ADR-009). The approach mirrors OpenAI's retrieval API rewrite_query option, suggesting that user-written prompts may not be optimally phrased for embedding-based search. By rewriting queries before embedding, the system aims to improve the relevance of recalled memories without changing the underlying recall architecture. The feature is currently in planned status and is tagged under recall functionality.

## Key facts

- The feature auto-rewrites user prompts into more retrieval-friendly queries before embedding
- Rewriting occurs before the query is embedded for recallByQuery (prompt-driven semantic recall)
- recallByQuery is defined in ADR-009
- The approach mirrors OpenAI's retrieval API rewrite_query option
- Status: planned, dated 2026-08-05
- Tagged under "recall"
- Linked to a proposal document in external LLM Workflow Optimization repository and ADR-009

## Open questions

- What specific rewriting strategy or model will transform user prompts?
- What criteria define "retrieval-friendly" in the context of Nexus's embedding space?
- Will rewriting be configurable or always-on?
- How much latency overhead would rewriting add to the recall pipeline?
- How does this feature interact with other query enhancement mechanisms?
