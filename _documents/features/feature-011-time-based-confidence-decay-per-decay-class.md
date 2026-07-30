---
id: FEAT-011
title: Time-based confidence decay per decay_class
status: implemented
date: 2026-07-26
links: []
tags: ["memory", "decay", "ranking"]
---

decay.ts implements effectiveConfidence = confidence * decayFactor(decay_class, last_verified_at) -- a genuine, non-destructive time-decay multiplier with per-decay_class grace period / half-life schedules (stable=never, architecture=30d/60d, api_contract=14d/30d, implementation=7d/14d). Reconfirming a memory resets the clock. Confirmed by direct source read; this was initially flagged as an open question in the improvements synthesis and resolved as already-implemented.
