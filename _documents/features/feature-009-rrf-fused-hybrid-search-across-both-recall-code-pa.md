---
id: FEAT-009
title: RRF-fused hybrid search across both recall code paths
status: implemented
date: 2026-07-26
links: []
tags: ["memory", "recall", "retrieval", "knowledge-vault"]
---

search.ts's hybridSearchMemories implements true Reciprocal Rank Fusion (RRF_K=60) fusing FTS5 and vector ranks for the ad-hoc nexus_search tool. recall.ts's recallByQuery (backing the per-prompt UserPromptSubmit recall via prompt-runner.ts) also now imports and uses the shared rrfFuse helper (rrf.ts), closing the inconsistency flagged earlier in the 2026-07 improvements research. Matches Reciprocal Rank Fusion / Reciprocal Rank Fusion Retrieval (knowledge-vault atoms) and Pi-Session-Search FTS5 Hybrid.
