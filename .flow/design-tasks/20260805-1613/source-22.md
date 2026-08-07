# Averaged session/project embeddings for topic-drift detection

**Source**: _documents/features/feature-20260805151847-bd-averaged-sessionproject-embeddings-for-topic-drift.md

## Summary

This planned feature explores whether aggregating per-turn embeddings into rolling session or project vectors could detect topic drift and improve system recall personalization and governance signals. The feature is in early research phase with implementation approach not yet decided. It proposes creating composite embeddings by averaging embeddings from individual turns within a session or project scope, with the goal of identifying when conversations shift to new topics and using those shifts to refine memory retrieval and governance decisions.

## Key facts

- Feature ID: FEAT-20260805151847-bd
- Status: planned
- Tagged as recall, embeddings, and needs-research
- Implementation approach not yet decided — requires investigation
- Proposes aggregating per-turn embeddings into rolling session or project vectors
- Intended to detect topic drift and improve recall personalization
- Intended to provide improved governance signals
- References proposal document: `../../LLM_Workflow_Optimization/_documents/proposals/retrieval-rag/PROP-20260804-145948-averaged-embeddings-for-session-user-vectors.md`

## Open questions

- What aggregation method (averaging, weighted averaging, etc.) would be most effective?
- What is the distinction in use case between session-level and project-level vectors?
- How would topic drift detection output be applied to recall rankings or governance decisions?
- Would implementation require changes to the embedding storage or query schema?
- How does this relate to existing session/project scoping in memory retrieval?
