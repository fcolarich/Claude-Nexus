---
id: ADR-20260820230120-e1
title: Claim dedup precision fix: identifier-conflict veto beyond zero-overlap
type: adr
date: 2026-08-20
status: accepted
supersedes: null
tags: ["claims", "dedup", "precision", "structured-memory"]
---

**Decision:** claim-dedup.ts vetoes a same_as/auto_merge match on ANY identifier-set difference between two claims, not just zero overlap (identifiersDisjoint in claim-dedup.ts, called before combinedSimilarity in consolidate-claims.ts).

**Alternatives:** Zero-overlap-only veto (only block when the two claims share NO identifiers at all). Measured on the same 39 real flagged pairs from a live-corpus consolidateClaims run: zero-overlap caught 2/39 false positives; any-difference caught 11/39 (9 real false positives correctly caught, 2 acceptable false negatives).

**Reason:** A live consolidateClaims run against 1,133 memories / 9,714 claims found a 38 percent false-positive rate on flagged same_as pairs: short template-like claims sharing nearly all sentence structure but naming a different symbol/file/entity (different Unity system groups, different function names, different doc-sync target files) scored high on embedding+fuzzy similarity because shared boilerplate dominates the score. Zero-overlap veto only catches pairs with NO shared identifiers, missing the dominant failure mode where pairs share MOST identifiers and differ on exactly the one that matters. Accepted trade-off: a missed duplicate is silent and harmless (same_as is a non-destructive pending-review edge), a wrong same_as edge actively asserts two different facts are the same thing.
