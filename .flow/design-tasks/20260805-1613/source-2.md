# Evaluate jina-reranker-v3 over v2 for prompt-driven recall

**Source**: `_documents/features/feature-002-evaluate-jina-reranker-v3-over-v2-for-prompt-drive.md`

## Summary

The Nexus reranker implementation in `src/core/reranker.ts` is currently pinned to jina-reranker-v2-base-multilingual, with reranking already enabled by default in `extraction_models.yaml`. This default-enabled state satisfies a prior recommendation from the improvements synthesis. The remaining work is to evaluate whether jina-reranker-v3—described as a newer, smaller, and stronger listwise reranking model—should replace the existing v2 implementation. The v3 model reportedly achieves a BEIR score of 61.94 with only 0.6B parameters, suggesting potential improvements in ranking quality while maintaining or reducing model size. The feature is tied to ADR-012, which presumably documents the architectural decisions around reranker adoption.

## Key facts

- `src/core/reranker.ts` is currently pinned to jina-reranker-v2-base-multilingual
- Reranker is enabled by default in `extraction_models.yaml`
- jina-reranker-v3 is a newer, smaller, and stronger listwise model than v2
- jina-reranker-v3 achieves BEIR 61.94 score at 0.6B parameters according to cited sources

## Open questions

- What testing or evaluation methodology is proposed to compare v3 against v2 in actual Nexus recall workloads?
- How do the practical performance differences (latency, accuracy, throughput) between v2 and v3 manifest in prompt-driven recall scenarios?
- Should v3 replace v2 entirely, or should both models remain configurable for users to choose between?
- Are there any known limitations, dependencies, or integration changes required to adopt v3?
