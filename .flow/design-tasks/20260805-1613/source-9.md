# Reconstruct a permanent incremental-window extraction validation harness

**Source**: _documents/features/feature-20260730150709-cf-reconstruct-a-permanent-incremental-window-extract.md

## Summary

The source describes the need for a maintainable validation harness to test incremental-window extraction in the memory capture pipeline. Previously, a one-off scratch harness was used to validate the completeness gap between whole-session and incremental-window extraction modes, and to verify a preference-crowding fix. That harness was discarded after use per project convention. The problem is that there is now no repeatable way to re-verify that future changes to SYSTEM_PROMPT do not degrade incremental-window extraction quality—specifically, to prevent regression of the preference-crowding failure or breakage of phase-section-cue recall (tied to a related feature). The feature is marked as requiring research to determine what a maintainable (non-throwaway) form of this validation harness should look like before implementation.

## Key facts

- A one-off scratch harness was previously used to validate the incremental-window extraction completeness gap and the preference-crowding fix.
- The scratch harness was cleaned up after use per project convention (throwaway scripts are not committed).
- There is currently no repeatable way to re-verify that future SYSTEM_PROMPT changes do not regress incremental-window extraction quality.
- Specific regression risks include re-introducing the preference-crowding failure and breaking phase-section-cue recall.
- Implementation approach has not yet been decided; the feature is marked as needing research.
- The feature links to NOTE-20260730134513-3b (related validation note) and FEAT-20260730150641-ad (phase-section-cue prompt tuning).

## Open questions

- What form should a maintainable (non-scratch) incremental-window validation harness take?
- Should the harness be automated as part of the test suite, or remain a manual verification tool?
- What specific extraction quality metrics or test cases should the harness validate?
