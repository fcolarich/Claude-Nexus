# Window-only extraction prompt variant (contingent on shared-addendum regression)

**Source**: _documents/features/feature-20260730150718-3e-window-only-extraction-prompt-variant-contingent-o.md

## Summary

This feature proposes a window-only extraction prompt variant controlled by a mode flag on the Extractor type. It would serve as a more targeted alternative to a preference-preservation addendum shipped in a shared SYSTEM_PROMPT (NOTE-20260730134513-3b), which currently affects both window-only and whole-session/backfill extraction. The feature was explicitly deferred during the earlier fix's design phase because implementing it requires changes to the exported Extractor type and all its conforming callers across four touch points: reflector.ts, backfill.ts, prompt-runner.ts, and test fakes. These changes fell outside the lean-scope constraints of the original two-file fix. The feature is contingent and should only be revisited if the shared-addendum approach later proves to regress extraction quality for whole-session or backfill operations. If no such regression occurs, the feature is unnecessary.

## Key facts

- The feature adds a mode flag to the Extractor type to gate window-only extraction prompt variants.
- It is positioned as a more targeted alternative to a preference-preservation addendum in a shared SYSTEM_PROMPT.
- The shared addendum affects both window-only extraction and whole-session/backfill extraction.
- Implementation would require changes to reflector.ts, backfill.ts, prompt-runner.ts, and test fakes.
- The feature was deferred from an earlier two-file fix due to scope constraints on exported type changes.
- The feature is contingent: revisit only if the shared-addendum approach regresses whole-session or backfill extraction quality.

## Open questions

- Will the shared-addendum approach actually cause a regression in whole-session or backfill extraction quality?
- What degree of extraction quality degradation would warrant revisiting this feature?
