# Adopt phase-section-cue prompt tuning for vcc_compact extraction

**Source**: `_documents/features/feature-20260730150641-ad-adopt-phase-section-cue-prompt-tuning-for-vcc-comp.md`

## Summary

This feature proposes adopting a "phase-section-cue" instruction pattern in the `extract.ts` system prompt for `vcc_compact`-sourced extraction. The technique treats each "### Phase: <name>" section as an independent scanning unit, requiring at least one durable fact to be extracted from each. 

The feature cites validation from experiments on real Flow-structured sessions, which demonstrated significant improvements in extraction completeness across both whole-session and incremental-window extraction modes. The experiments recovered content the untuned prompt missed, including ADR/DDR pointers, concurrency bugs, and tool-specific quirks. 

The feature notes that a smaller related optimization—described as a "preference-crowding addendum" (referenced in NOTE-20260730134513-3b)—has already shipped. However, this broader phase-cue tuning remains pending implementation. The work is classified as an extraction and prompt-tuning improvement targeting the `vcc_compact` extraction pipeline.

## Key facts

- Phase-section-cue instruction treats each "### Phase: <name>" section as an independent unit worth scanning for at least one durable fact
- The technique was validated via experiment on real Flow-structured sessions
- Validation showed significant improvement in extraction completeness for both whole-session and incremental-window extraction modes
- Recovered content includes ADR/DDR pointers, concurrency bugs, and tool quirks
- A smaller preference-crowding addendum from this work (NOTE-20260730134513-3b) has already shipped
- The broader phase-cue tuning itself is still pending implementation
- The feature is tagged as extraction, prompt-tuning, and vcc_compact related

## Open questions

- What specific changes to the SYSTEM_PROMPT in extract.ts are required to implement this instruction?
- How should the phase-section-cue instruction be weighted against other extraction criteria?
- Are there constraints on minimum or maximum number of phases to be scanned in a single extraction run?
- How does this interact with or depend on the already-shipped preference-crowding addendum?
