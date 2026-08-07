# Compound attribute filters for nexus_search (eq/in/and/or)

**Source**: _documents/features/feature-20260805151847-81-compound-attribute-filters-for-nexus-search-eqinan.md

## Summary

The feature proposes extending nexus_search's filtering capability beyond its current scope enum to support a structured compound filter schema with logical and relational operators (equality, membership, and, or) over typed memory fields. The new schema should match the shape and semantics used by OpenAI's file_search attribute filters, enabling more expressive and flexible filtering of memories during retrieval operations. This would allow queries to combine multiple filter conditions and apply them to different typed attributes rather than being limited to a single scope filter.

## Key facts

- The current nexus_search filtering is limited to a scope enum
- The feature introduces a compound filter schema supporting eq/in/and/or operators
- Filters operate over typed memory fields
- The filter schema design mirrors OpenAI's file_search attribute filter shape
- Status is planned as of 2026-08-05
- Feature is tagged for recall and MCP subsystems

## Open questions

- What specific typed memory fields should support filtering?
- What are the current limitations of the scope enum that necessitate this change?
- How should the compound operators (and/or) nest and evaluate?
- Are there backward compatibility requirements with existing scope-based queries?
- What is the implementation priority relative to other retrieval features?
- Should there be pagination or result-size limits on compound filter queries?
