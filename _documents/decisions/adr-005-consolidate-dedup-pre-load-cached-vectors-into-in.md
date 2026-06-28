---
id: ADR-005
title: Consolidate dedup: pre-load cached vectors into in-memory Map before the loop
type: adr
date: 2025-01-01
status: accepted
supersedes: null
tags: []
---

**Decision:** The consolidate dedup pass pre-loads all cached embedding vectors from `memories_vec` into an in-memory `Map<id, Float32Array>` before entering the per-memory loop. Each iteration looks up the vector in the Map first; only memories absent from the Map fall through to `embedFn` (an Ollama HTTP call). Previously, every iteration called `embedFn` unconditionally, issuing 3,363+ redundant Ollama HTTP requests per consolidation run.

**Alternatives considered:**
- Keep calling `embedFn` per memory: original behavior — correct but slow (~30+ minutes per run dominated by network I/O).
- Lazy DB lookup per iteration (SELECT from `memories_vec` inside the loop): avoids the upfront Map build but still pays one DB round-trip per memory; no better than a Map for warm caches, and harder to reason about.
- Persist embeddings in the `memories` table directly: would couple the main table to embedding format; rejected to keep schema concerns separated.

**Reason:** The corpus is small enough (~few thousand memories) that loading all vectors into RAM upfront is negligible (< 1 MB). The Map lookup is O(1) per memory, eliminating all redundant network calls. Result: dedup pass drops from 30+ minutes to ~33 seconds, now dominated by sqlite-vec KNN queries rather than Ollama HTTP I/O.
