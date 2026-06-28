---
id: ADR-003
title: Corpus expansion v2.1: hybrid BM25 + dense auto-linking via RRF
type: adr
date: 2025-01-01
status: accepted
supersedes: null
tags: []
---

**Decision:** After embedding each new atom or memory, `linkAtom` / `linkMemory` (`src/core/links.ts`) run a hybrid retrieval: dense KNN over `atoms_vec` / `memories_vec` (TOP_K=12) merged with in-memory BM25 (`wink-bm25-text-search`) via Reciprocal Rank Fusion (K=60). Results above cosine 0.86 get `duplicates` links; 0.70–0.86 get `related` links. Links are bidirectional (two rows in `atom_links` / `memory_links`). A `linked_at` skip guard prevents re-linking when `linked_at > updated_at`. The BM25 corpus is built in-memory per call (never persisted); for batch runs (`embedUnindexed`), one corpus is built once and passed to all `linkAtom` calls to avoid O(N²) rebuilds. `project_doc` atoms (`.md` files from `sessions.cwd` paths) are indexed alongside `~/.claude/` atoms as of migration 6.

**Alternatives:** Dense-only linking — misses keyword-exact atoms with low cosine (short config snippets). FTS5-only — no semantic similarity. External graph DB — unnecessary complexity.

**Reason:** Hybrid retrieval catches both keyword-identical and semantically similar content. RRF is cheap, well-understood, and requires no score normalization before merging. wink-bm25-text-search is pure JS (zero native deps).
