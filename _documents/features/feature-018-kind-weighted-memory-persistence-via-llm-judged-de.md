---
id: FEAT-018
title: Kind-weighted memory persistence via LLM-judged decay_class
status: implemented
date: 2026-07-26
links: []
tags: ["memory", "decay", "knowledge-vault"]
---

extract.ts's extraction system prompt instructs the Haiku LLM to assign decay_class per-memory based on the content's actual durability (stable/architecture/api_contract/implementation), rather than a fixed memory_type-to-decay-rate lookup table. This is a more accurate, content-aware implementation of the knowledge-vault's Kind-weighted Persistence Score atom (ATOM-456), which proposes a static tau lookup by memory kind -- Nexus's per-item LLM judgment subsumes the simpler fixed-table approach.
