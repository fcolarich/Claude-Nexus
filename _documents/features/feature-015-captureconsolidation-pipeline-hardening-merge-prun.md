---
id: FEAT-015
title: Capture/consolidation pipeline hardening (merge, prune, demote, size cap)
status: implemented
date: 2026-07-26
links: []
tags: ["memory", "capture", "consolidation", "knowledge-vault"]
---

consolidate.ts's nexus_consolidate already runs merge+prune+demote+contradiction-detection as a single sweep. A pre-LLM signal-based candidate filter and an LLM-rewrite consolidation pass were both evaluated and explicitly declined (documented 'Q4 NO-GO' comments in extract.ts/consolidate.ts) rather than left unaddressed. export.ts already caps the exported MEMORY.md via memory_md_max_items. Matches knowledge-vault atoms Signal-Based Selective Capture (ATOM-425), Memory Consolidation Pass (ATOM-426), and MEMORY.md Size-Cap Guard (ATOM-428) -- evaluated and either implemented or deliberately declined with rationale, not an open gap.
