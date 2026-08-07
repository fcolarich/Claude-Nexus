# Cosine-similarity zero-shot classification as a cheaper alternative to Haiku calls

**Source**: _documents/features/feature-20260805151847-7e-cosine-similarity-zero-shot-classification-as-a-ch.md

## Summary

The feature proposes replacing Haiku-based classification calls with cosine similarity matching against a small set of labeled anchor embeddings. The approach targets classification tasks where full LLM judgment is not required—specifically origin classification and governance checks—to achieve cost and latency reductions. The implementation approach has not yet been decided and requires evaluation to determine whether cosine similarity can achieve comparable accuracy and reliability for these specific use cases.

## Key facts

- Proposes using cosine similarity against labeled anchor embeddings as an alternative to Haiku classification calls
- Targets cost/latency wins for cases where full LLM judgment is not needed
- Specific classification use cases identified: origin classification, governance checks
- Implementation approach is not yet decided
- Status is "planned" and marked as "needs-research"

## Open questions

- What is the set of labeled anchor embeddings, and how should it be constructed for each classification task?
- Can cosine similarity achieve acceptable accuracy compared to current Haiku classification for origin and governance checks?
- Which classification tasks should be prioritized for this optimization first?
- What is the baseline cost and latency comparison between cosine similarity and current Haiku calls?
