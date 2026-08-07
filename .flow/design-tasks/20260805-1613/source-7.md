# Raise MAX_CANDIDATES for vcc-sourced extraction path

**Source**: _documents/features/feature-20260730150650-7f-raise-max-candidates-for-vcc-sourced-extraction-pa.md

## Summary

This planned feature proposes increasing the MAX_CANDIDATES parameter (currently 20 in extract.ts) for the vcc_compact-sourced extraction path. The parameter is not yet a binding constraint on incremental windows, which observe a maximum of 9–11 candidates per window, nor on most whole-session runs. However, adoption of phase-section-cue tuning (a companion feature) is expected to push whole-session or long-window extraction loads close to or past the current cap, making this increase necessary. The raise would be specific to the vcc_compact extraction path to address capacity constraints introduced by more aggressive cue-based tuning.

## Key facts

- MAX_CANDIDATES is currently set to 20 in extract.ts
- The feature applies specifically to the vcc_compact-sourced extraction path
- Incremental windows currently observe a maximum of 9–11 candidates per window
- Phase-section-cue tuning (linked feature FEAT-20260730150641-ad) can push whole-session or long-window extraction close to or past the current cap
- Not currently a binding constraint on most extraction workloads

## Open questions

- What should the new MAX_CANDIDATES value be set to?
- What are the performance and memory implications of raising the limit?
- Are there other downstream constraints that would become apparent once this limit is increased?
