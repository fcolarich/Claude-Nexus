# Reorder-then-compress: place highest-relevance memories at context boundaries

**Source**: _documents/features/feature-20260805151847-4c-reorder-then-compress-place-highest-relevance-memo.md

## Summary

This feature proposes a memory-ordering strategy to address the "lost in the middle" attention degradation problem in LLMs. When injecting recalled memories into the prompt context, the proposal is to place the highest-relevance memories at the boundaries (first and last positions) rather than leaving them potentially buried in the middle of the context window. The reordering would occur before the existing full-body-to-titles-only degradation step (referenced as FEAT-008), which reduces longer memories to title-only form to save tokens. By positioning top-relevance items at the edges where model attention is strongest, this approach aims to preserve the most important recalled information's visibility to the model.

## Key facts

- The feature targets the recall context assembly stage of memory injection
- Highest-relevance memories should be placed at first/last positions in injected context
- The reordering occurs before existing full-body-to-titles-only degradation (FEAT-008)
- The underlying problem is "lost in the middle" attention degradation in longer injected contexts

## Open questions

- What metric or scoring determines "highest-relevance" for ordering?
- How is "first/last positions" defined when context length varies?
- What is the expected accuracy or recall improvement from this ordering change?
- Does this interact with existing memory ranking or relevance scoring mechanisms?
