---
id: FEAT-007
title: Observer-Reflector two-phase capture pipeline
status: implemented
date: 2026-07-26
links: []
tags: ["memory", "capture", "knowledge-vault"]
---

reflector.ts implements the two-phase Observer/Reflector shape: read new transcript lines (observer, no writes) then Haiku extraction + semantic dedup + insert (reflector). Matches the AnythingLLM-sourced Observer-Reflector Memory Extraction pattern (knowledge-vault atom) -- prevents premature writes of volatile in-progress state.
