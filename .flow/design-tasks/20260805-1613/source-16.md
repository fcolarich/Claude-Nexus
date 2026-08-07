# Tunable embedding/text weight for hybrid search fusion

**Source**: _documents/features/feature-20260805151847-68-tunable-embeddingtext-weight-for-hybrid-search-fus.md

## Summary

This feature explores making nexus's hybrid search fusion approach configurable. Currently, the system uses a fixed RRF (Reciprocal Rank Fusion) constant of K=60 to combine embedding-based and text-based search signals. The proposal is to evaluate whether replacing this fixed constant with tunable embedding_weight and text_weight parameters would improve recall quality. The feature is in "needs-research" status, meaning the implementation approach has not yet been decided. The key evaluation question is whether the improvement in recall quality from tunable fusion weights justifies the added configuration surface area.

## Key facts

- The current implementation uses fixed RRF_K=60 fusion (specified in ADR-003)
- Implementation approach has not yet been decided
- The proposal is to replace fixed RRF_K=60 with a tunable embedding_weight/text_weight ratio
- The feature requires research to determine feasibility and impact
- Success criteria: improvement in recall quality must justify the added config surface

## Open questions

- Should the fixed RRF_K=60 fusion be replaced with tunable embedding_weight and text_weight parameters?
- Does configurable fusion weighting improve recall quality?
- Is the improvement significant enough to justify the added configuration complexity?
