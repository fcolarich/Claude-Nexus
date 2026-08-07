# Constrained decoding for JSON-schema-valid Haiku extraction output

**Source**: _documents/features/feature-20260805151847-eb-constrained-decoding-for-json-schema-valid-haiku-e.md

## Summary

This feature proposes adding constrained-decoding capability to the extraction call path (extract.ts) to guarantee schema-valid memory JSON output and eliminate parse-failure retries. The mechanism would enforce JSON schema compliance at generation time rather than validating after the fact. Implementation options under investigation include XGrammar, llguidance, or GBNF-style JSON schema enforcement. The feature is scoped only to locally-served extraction models, not the Anthropic API endpoint. The implementation approach has not yet been decided and requires research to determine feasibility and the best technical approach.

## Key facts

- Feature targets the extraction call path (extract.ts) to enforce schema-valid JSON output during generation
- Proposed constrained-decoding approaches include XGrammar, llguidance, or GBNF-style JSON schema enforcement
- Feature is applicable only when nexus extraction model is served locally, not via the Anthropic API
- Goal is to eliminate parse-failure retries by preventing invalid schemas at generation time
- Feature status is "planned" and tagged as "needs-research"
- Related proposal: PROP-20260803-210128-constrained-decoding-xgrammar-llguidance-gbnf.md

## Open questions

- Which constrained-decoding framework (XGrammar, llguidance, GBNF) is most suitable for this use case?
- What is the performance overhead of constrained decoding compared to unconstrained generation?
- How will constrained decoding be integrated into the extract.ts call path?
- What is the timeline for when nexus extraction will be served locally rather than via the Anthropic API?
