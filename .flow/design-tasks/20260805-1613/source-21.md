# Contextual retrieval indexing: prepend context header before embedding memory bodies

**Source**: _documents/features/feature-20260805151847-ae-contextual-retrieval-indexing-prepend-context-head.md

## Summary

This planned feature adopts Anthropic's contextual retrieval technique by prepending a short context header (containing project, memory_type, decay_class, and related topic) to each memory body before embedding it. The source cites empirical results showing that context-prepend alone reduces retrieval failures by 35%, combined with BM25 reduces failures by 49%, and combined with reranking reduces failures by 67%. Since Nexus already implements BM25 hybrid search (FEAT-009) and reranking (ADR-012), this feature targets only the missing context-prepend step to close the retrieval quality gap.

## Key facts

- Contextual retrieval indexing involves prepending a short context header before embedding memory bodies.
- The header includes: project, memory_type, decay_class, and related topic.
- Cited results show context-prepend reduces retrieval failures by 35% alone.
- Combined with BM25, context-prepend reduces retrieval failures by 49%.
- Combined with reranking, context-prepend reduces retrieval failures by 67%.
- Nexus already has BM25 hybrid search (FEAT-009) and reranking (ADR-012) implemented.
- Only the context-prepend step is currently missing from Nexus.

## Open questions

- What constitutes the "related topic" context field — how is it derived or selected?
- Should the context header format be standardized, and if so, what is the exact format?
- What is the performance cost (latency, embedding dimension impact) of prepending context headers at embedding time?
- Should existing embeddings be re-embedded with the new context header, or only new memories?
