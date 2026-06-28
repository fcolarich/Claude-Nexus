---
id: DDR-004
title: Capture quality thresholds: observer gate signals, cosine dedup, and approval gate
type: ddr
date: 2025-01-01
status: accepted
supersedes: null
tags: []
---

**Decision:** Three numeric thresholds govern capture quality, all configurable in `extraction_models.yaml`:

1. **Observer gate signals** — before calling the LLM, the Reflector checks: ≥1 user message in the window, ≥4 exchanges total, presence of a tool error, or a correction/preference marker phrase. All four are OR-conditions; any one triggers extraction. Windows that satisfy none skip the LLM call entirely.

2. **Semantic dedup threshold** (`capture.dedup_cosine_threshold`, default 0.86) — after embedding a new candidate memory, a KNN query finds existing memories. Cosine ≥ 0.86 = near-duplicate: the existing memory's `last_verified_at` is touched (re-verified) and the candidate is not inserted. This is the same threshold used by `linkAtom`/`linkMemory` for `duplicates` links (ADR-003).

3. **Auto-approval threshold** (`capture.auto_approve_confidence`, default 0.85) — candidates with extraction confidence ≥ 0.85 are inserted with `review_status='approved'` and enter recall immediately. Below 0.85, they land in `review_status='pending'` and are excluded from recall until approved in the Review view (DDR-001).

**Alternatives considered:**
- Fixed thresholds baked into code — rejected; early tuning showed the right values depend on corpus size and model behaviour, so they must be configurable without a rebuild.
- Single threshold for both dedup and approval — different concerns: dedup is a vector similarity question; approval is an extraction confidence question. They happened to converge near 0.85–0.86 but are conceptually independent.

**Reason:** The three-gate design means the LLM is called only when there is likely signal (observer gate), duplicates are caught semantically not just lexically (cosine dedup), and low-confidence extractions never corrupt recall without human review (approval gate).
