---
id: FEAT-20260730150641-ad
title: Adopt phase-section-cue prompt tuning for vcc_compact extraction
status: planned
date: 2026-07-30
links: ["NOTE-20260730134513-3b"]
tags: ["extraction", "prompt-tuning", "vcc_compact"]
---

Adopt the validated phase-section-cue instruction (treat each "### Phase: <name>" section as an independent unit worth scanning for at least one durable fact) in extract.ts's SYSTEM_PROMPT for vcc_compact-sourced extraction. Validated via experiment on real Flow-structured sessions: significantly improved extraction completeness (whole-session and incremental-window), recovering ADR/DDR pointers, concurrency bugs, and tool quirks the untuned prompt missed. Only the smaller preference-crowding addendum (NOTE-20260730134513-3b) shipped so far; this broader phase-cue tuning is still pending.
