# Formal 3-axis memory quality eval rubric (recall/preference/staleness)

**Source**: _documents/features/feature-20260805151847-ce-formal-3-axis-memory-quality-eval-rubric-recallpre.md

## Summary

This feature proposes replacing nexus's current single effectiveConfidence/help-rate signal with a formal rubric that evaluates memory quality across three independent axes: retrieval usefulness (how helpful the memory is when recalled), user preference alignment (whether the memory matches the user's stated preferences), and staleness (how outdated the information has become). The feature is marked as planned but requires research into the implementation approach. The proposal is informed by a ChatGPT memory dreaming write-up that explores multi-dimensional memory scoring strategies.

## Key facts

- The current nexus system relies on a single effectiveConfidence/help-rate metric for memory quality
- The proposed rubric introduces three distinct axes: retrieval usefulness, user preference alignment, and staleness
- Implementation approach has not yet been decided
- The feature is categorized as governance and requires research before development can begin
- An external proposal document exists (from LLM_Workflow_Optimization project) that serves as the source reference

## Open questions

- How should each of the three axes be measured or scored numerically?
- Should the three axes be weighted equally or differently?
- How should the three independent scores be combined into a single quality ranking for recall prioritization?
- What decay curve should be used for the staleness axis?
- Should user preference alignment be evaluated per-user or as a global aggregate?
- Should memories be re-scored automatically over time, or only during recall?
