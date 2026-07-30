---
id: FEAT-20260730150650-7f
title: Raise MAX_CANDIDATES for vcc-sourced extraction path
status: planned
date: 2026-07-30
links: ["FEAT-20260730150641-ad"]
tags: ["extraction", "vcc_compact", "capacity"]
---

Raise MAX_CANDIDATES (currently 20, in extract.ts) for the vcc_compact-sourced extraction path specifically. Not currently a binding constraint on incremental windows (max observed 9-11/window) or most whole-session runs, but would become one once phase-section-cue tuning is adopted (see FEAT-20260730150641-ad), since that cue can push whole-session or long-window extraction close to or past the current cap.
