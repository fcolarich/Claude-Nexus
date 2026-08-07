# Typed metadata retrieval filters (string/number/time) on memories

**Source**: _documents/features/feature-20260805151847-d1-typed-metadata-retrieval-filters-stringnumbertime.md

## Summary

This feature proposes extending the Nexus recall system with typed metadata filtering capabilities beyond the current scope and decay_class enums. The proposal would add support for numeric and time-range filtering on the nexus_search function, enabling more precise and targeted retrieval of memories based on structured metadata attributes. The document identifies this as a research task rather than a ready-to-implement feature, flagging that the specific implementation approach has not yet been decided. The core question driving the research is whether adding these typed metadata filters would produce meaningful improvements in targeted recall accuracy and precision, or whether existing semantic and decay-based ranking mechanisms are already sufficient for the system's recall needs.

## Key facts

- The feature is tagged as "needs-research" with status "planned"
- Current filtering is limited to scope and decay_class enums only
- Proposed enhancement would add typed metadata fields supporting numeric and time-range filters
- Filtering would operate on the nexus_search function
- Implementation approach has not yet been decided
- The value proposition is unvalidated—whether improvement to targeted recall would be meaningful is an open question
- References an external proposal document in the LLM_Workflow_Optimization project

## Open questions

- Which specific typed metadata fields should be exposed for filtering?
- How should numeric and time-range filters be combined with semantic search scoring?
- Would these filters operate as hard constraints or as soft ranking adjustments?
- What is the expected performance impact of indexing and querying on typed metadata fields?
- How would these filters integrate with the existing decay-ranked recall system?
