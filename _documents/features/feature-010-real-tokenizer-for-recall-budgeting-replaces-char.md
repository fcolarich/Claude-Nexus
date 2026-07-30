---
id: FEAT-010
title: Real tokenizer for recall budgeting (replaces char-count heuristic)
status: implemented
date: 2026-07-26
links: []
tags: ["memory", "recall", "tokenizer"]
---

recall.ts uses gpt-tokenizer's encode() to estimate memory body token cost when walking the recall budget, rather than a flat 4-chars-per-token heuristic. This closes the estimation-accuracy gap identified for code snippets, ADR citations, and non-English text in the 2026-07 improvements research.
