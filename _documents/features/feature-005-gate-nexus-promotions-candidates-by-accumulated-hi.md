---
id: FEAT-005
title: Gate nexus_promotions candidates by accumulated hit_count/reconfirmation
status: planned
date: 2026-07-26
links: []
tags: ["memory", "promotion", "governance", "knowledge-vault"]
---

promotion_target is currently set once by the Haiku extraction LLM at write time (extract.ts) and nexus_promotions simply lists every memory where promotion_target != none and not yet promoted. Verified by direct grep: governance.ts (which runs governByHelpRate confidence reinforcement/demotion from accumulated use_count/help_rate) never touches promotion_target -- flagging is never revisited after the initial one-shot LLM guess, no matter how the memory performs afterward. This risks surfacing premature promotion candidates that later prove rarely used or unreliable. Recommended: add a threshold gate (e.g. use_count >= 3 and/or a help_rate floor) before a flagged memory surfaces in nexus_promotions output, so candidates must prove durable value across multiple recalls before a human is asked to formalize them into an ADR/DDR/skill. Evidence: knowledge-vault ATOM-529 Memory Promotion Pipeline (source: pi-skillforge) describes exactly this pattern (confidence=confirmed + hit_count>=3 gate before human review). Low-medium effort -- an additional WHERE-clause filter in nexus_promotions existing SQL; use_count/help_count already exist on the memories table, no schema change needed.
