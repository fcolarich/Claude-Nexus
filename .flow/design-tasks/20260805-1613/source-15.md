# Loop-prevention memory: track already-attempted fixes to avoid re-suggesting them

**Source**: _documents/features/feature-20260805151847-5a-loop-prevention-memory-track-already-attempted-fix.md

## Summary

This feature proposes a mechanism to prevent Claude from repeatedly suggesting the same fix or debugging approach that has already been attempted and failed within a debugging session. The implementation approach remains under research and has not yet been finalized.

The core objective is to introduce a convention—likely a new memory_type or tag—that records fixes or approaches already tried without success. This record would be consulted during recall to suppress re-suggestion of previously attempted solutions when addressing the same problem. The feature assumes that within a given debugging context, certain fixes that have been tried and failed should be explicitly remembered and filtered from future suggestions, breaking a loop of repetitive recommendations.

The feature references an external proposal from Cline's work on recursive self-improvement, specifically addressing state-file loop-prevention logs. This suggests the implementation may draw on patterns for session-scoped or persistent state tracking.

The feature is tagged as requiring research and categorized under capture, indicating it concerns how memories are recorded and stored rather than retrieval or presentation logic. No specific implementation details, timelines, or success criteria are provided at this stage.

## Key facts

- Implementation approach is undecided
- Intended to track fixes or approaches already attempted and failed
- Would suppress re-suggestion of the same fix within a debugging session
- References Cline's state-file loop-prevention log proposal as a starting point
- Tagged "capture" and "needs-research"
- Status is planned (not yet in development)

## Open questions

- What convention should record already-attempted fixes (new memory_type? new tag? other metadata)?
- What scope defines "already-attempted"—entire session, debugging context, or conversation turn?
- Should tracking be session-scoped, project-scoped, or permanent per codebase?
- How should recall integrate this information to filter or deprioritize suggestions?
- Should failed attempts be archived or purged after session end?
