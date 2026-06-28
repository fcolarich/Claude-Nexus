---
id: DDR-003
title: Recall ranking: effective confidence × help-rate with load_at_init bypass
type: ddr
date: 2025-01-01
status: accepted
supersedes: null
tags: []
---

**Decision:** Recall ranks memories by `effectiveConfidence × helpRate` where `helpRate = help_count / use_count` (defaults to 1.0 when `use_count = 0`). `load_at_init = 1` memories sort first and bypass the `min_confidence` threshold. The budget walk emits full bodies until `max_tokens` is reached, then titles-only for the remainder. Project-scoped and global/shared memories are queried in a dual bank — both contribute to the ranked list.

**Alternatives:** Recency-only ranking — ignores whether a memory actually helped. Confidence-only — ignores feedback signal. Separate budgets for project vs global memories — more complex for marginal benefit.

**Reason:** The `help_count / use_count` signal closes the loop: memories that consistently help get recalled more; memories that don't decay out. The `load_at_init` bypass gives operators an escape hatch for critical conventions that must always appear regardless of decay state.
