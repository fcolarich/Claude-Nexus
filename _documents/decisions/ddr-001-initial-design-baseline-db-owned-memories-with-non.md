---
id: DDR-001
title: Initial design baseline: DB-owned memories with non-destructive decay and review gate
type: ddr
date: 2025-01-01
status: accepted
supersedes: null
tags: []
---

**Decision:** The `memories` table is DB-owned and written exclusively by the Reflector — not file-mirrored in the primary store (unlike `atoms`). Memory IDs are content-addressed (`sha256(memory_type + body)[:16]`) so identical extractions collapse to one row and near-duplicates are caught by semantic dedup. Decay is non-destructive: stored `confidence` is intrinsic; effective confidence = `confidence × decayFactor(decay_class, last_verified_at)`. Decayed memories fall out of recall but are never auto-deleted — `verify` revives them. Low-confidence extractions land in `review_status='pending'` and are excluded from recall until approved in the Review view. Superseded memories (from consolidate/distill) are kept as an audit trail (`superseded_by` FK), hidden from recall and export. Only explicitly rejected memories are pruned.

**Alternatives considered:**
- File-first store (v1 atoms pattern): markdown as source of truth — rejected for `memories` because the DB enables atomic writes, dedup, and decay scoring that file ops cannot safely provide.
- Hard-delete on merge: simpler but loses audit history and makes the consolidate/distill operations irreversible.
- No review gate: auto-approve all extractions — rejected because Haiku occasionally extracts noise; the review queue lets humans catch low-confidence or incorrect memories before they pollute recall.

**Reason:** Non-destructive decay lets memories "come back" when verified rather than requiring re-extraction. The review gate is the quality control valve — it keeps recall signal-to-noise high without requiring every extraction to be perfect. Content-addressed IDs make the pipeline idempotent: re-running the Reflector over the same transcript produces no duplicate rows.
