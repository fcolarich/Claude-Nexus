# Gate nexus_promotions candidates by accumulated hit_count/reconfirmation

**Source**: _documents/features/feature-005-gate-nexus-promotions-candidates-by-accumulated-hi.md

## Summary

The nexus_promotions pipeline currently surfaces memory promotion candidates immediately after the Haiku extraction LLM flags them at write time, without revisiting the promotion_target field based on actual usage patterns. Once marked, a memory becomes a candidate regardless of how frequently it is recalled or how well it performs across multiple uses. This creates risk of promoting premature candidates that later prove unreliable or rarely used. The proposal is to gate promotion candidates behind empirical thresholds—for example, requiring use_count >= 3 or a help_rate floor—before surfacing them for human review. This ensures candidates must demonstrate durable value across multiple recall cycles before a human is asked to formalize them into architecture or design records. The implementation is low-to-medium effort: a WHERE-clause filter in the existing nexus_promotions SQL query. No schema changes are required because use_count and help_count fields already exist on the memories table.

## Key facts

- promotion_target is currently set once by the Haiku extraction LLM at write time in extract.ts and is never revisited after initial flagging.
- governance.ts (which applies confidence reinforcement and demotion via accumulated use_count/help_rate) does not touch promotion_target.
- nexus_promotions lists every memory where promotion_target != none, regardless of subsequent performance or recall frequency.
- The knowledge-vault ATOM-529 Memory Promotion Pipeline pattern (from pi-skillforge) describes a gate requiring both confidence=confirmed and hit_count >= 3 before human review.
- Recommended implementation: add WHERE-clause filter to nexus_promotions SQL using existing use_count/help_count fields; no schema changes needed.
- Estimated effort: low-to-medium.

## Open questions

- What specific help_rate floor (if any) should accompany or replace the use_count >= 3 threshold?
- Should the gate be configurable per promotion category, or applied uniformly?
- How long after write should a memory be eligible for promotion consideration (i.e., should a minimum age gate also apply)?
