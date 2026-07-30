---
id: FEAT-20260730150709-cf
title: Reconstruct a permanent incremental-window extraction validation harness
status: planned
date: 2026-07-30
links: ["NOTE-20260730134513-3b", "FEAT-20260730150641-ad"]
tags: ["extraction", "testing", "needs-research"]
---

Needs research: implementation approach not yet decided -- requires investigating what a maintainable (non-scratch) form of the incremental-window validation harness should look like before building it. The one-off scratch harness used to validate both the whole-session-vs-incremental-window completeness gap and the preference-crowding fix (NOTE-20260730134513-3b) was cleaned up after use per project convention (throwaway scratch scripts are not committed). There is currently no repeatable way to re-verify that future SYSTEM_PROMPT changes do not regress incremental-window extraction quality -- e.g. re-introducing the preference-crowding failure, or breaking phase-section-cue recall (FEAT-20260730150641-ad) -- short of re-running a full manual simulation from scratch each time.
