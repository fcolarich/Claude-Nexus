---
id: FEAT-008
title: Budgeted dual-bank recall (full-body to titles-only degradation)
status: implemented
date: 2026-07-26
links: []
tags: ["memory", "recall", "knowledge-vault"]
---

recall.ts's recallMemories walks memory bodies until a token budget is exhausted then degrades to titles-only with an elision message, querying both project and global/shared banks in one pass. Matches the Pi-Hindsight Recall Budget Pattern (knowledge-vault atom) -- per-phase budget caps and dual-bank (project vs #global) architecture.
