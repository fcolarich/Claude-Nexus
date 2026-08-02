---
id: FEAT-20260802190757-2d
title: Fix vcc_compact rendering quality and re-verify before re-enabling reflector's post-extraction shrink
status: planned
date: 2026-08-02
links: ["ADR-015"]
tags: ["capture", "reflector", "vcc_compact", "data-safety", "needs-research"]
---

Needs research: implementation approach not yet decided. ADR-015 disabled reflector.ts's call to vcc.compactFileInPlace() because a review found real information loss in vcc_compact's rendering - opaque Bash/PowerShell tool-result citations and small-but-critical tool results get dropped when not restated in prose - and compactFileInPlace() overwrites the only copy of the raw transcript JSONL in place, so running a known-lossy renderer against it is unacceptable. ADR-015 names fixing the rendering quality first, then re-enabling, as the deferred precondition, but does not specify how the renderer should be fixed. This feature tracks that fix plus re-verification as the explicit re-enable precondition.
