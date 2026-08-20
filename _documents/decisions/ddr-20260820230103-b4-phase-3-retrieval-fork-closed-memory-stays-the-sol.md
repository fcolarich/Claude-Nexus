---
id: DDR-20260820230103-b4
title: Phase 3 retrieval fork closed: memory stays the sole retrieval unit
type: ddr
date: 2026-08-20
status: accepted
supersedes: null
tags: ["retrieval", "claims", "phase-3", "structured-memory"]
---

**Decision:** Claim-level retrieval is NOT wired into recall.ts/nexus_search. Memory stays the sole unit of retrieval; claims_vec embeddings remain scoped exclusively to the dedup cascade.

**Alternatives:** Route nexus_search/recallByQuery through claims_vec instead of (or blended with) memories_vec, on the theory that atomic facts retrieve more precisely than whole narrative memories.

**Reason:** Measured head-to-head on the live corpus (project-scoped, 10 real queries drawn from this projects actual worked topics). Memory-level retrieval showed sharp signal: correct top-1/2 result then a hard cliff to noise (score 0.016) for 8/10 queries. Claim-level retrieval was flat and noisy: similarity scores clustered 0.6-0.8 with no separation between relevant and irrelevant, average overlap with memory-levels top-5 was only 0.4/5, and wrong-topic global/shared-scope claims routinely outranked the actually-relevant memory. Root cause: claim facts are short, decontextualized single sentences (e.g. Rollback restores a SQLite virtual table) losing the topic-disambiguating context a memorys title+body carries. This empirically confirms the design docs a priori caution rather than overriding it. If claim-level retrieval is revisited, it would need contextual embedding (prefix claim embeddings with parent memory title/type) before being worth re-testing.
