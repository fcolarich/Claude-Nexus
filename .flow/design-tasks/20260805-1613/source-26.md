# Local model co-residency/routing plan for nexus's reranker + embedder stack

**Source**: _documents/features/feature-20260805151848-2a-local-model-co-residencyrouting-plan-for-nexuss-re.md

## Summary

This planned feature addresses infrastructure concerns around running nexus's local reranker and mxbai-embed-large embedder without encountering VRAM contention when multiple locally-served models operate in parallel. Rather than designing these components in isolation, the feature calls for investigating co-residency or swap-routed model architectures—such as llama-swap—to orchestrate how models share GPU memory. The implementation approach has not yet been decided and requires research into workable strategies for model coordination on shared hardware.

## Key facts

- Nexus currently depends on mxbai-embed-large embedder and a local reranker (referenced in ADR-012)
- The feature targets prevention of VRAM contention between these models and other locally-served models
- Two research directions are linked: an RTX 3090 co-resident config proposal and a llama-swap proposal from the LLM Workflow Optimization project
- Implementation approach is explicitly undecided and marked as requiring research

## Open questions

- What architectural pattern (co-residency vs. swap-routing vs. other) best suits nexus's inference load profile?
- How should model lifecycle management (load/unload timing) be coordinated to minimize memory thrashing?
- What are the performance trade-offs between different routing strategies for reranker + embedder workloads?
- Does the chosen approach require changes to the embeddings or reranking service interfaces?
