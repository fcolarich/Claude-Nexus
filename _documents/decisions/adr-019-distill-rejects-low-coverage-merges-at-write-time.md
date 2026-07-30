---
id: ADR-019
title: Distill rejects low-coverage merges at write time instead of raising the clustering band
type: adr
date: 2026-07-26
status: accepted
supersedes: null
tags: ["distill", "data-integrity", "embeddings", "memory-lifecycle", "verification"]
---

**Decision:** distillMemories gains a coverage gate: after inserting and embedding a candidate merge, coverageShortfall() computes its cosine against every source it folded in using vectors already in memories_vec, and if any falls below MERGE_COVERAGE_FLOOR (0.72) the merge row is deleted and no original is superseded. The rejection is counted in a new DistillResult.rejected field and surfaced by the MCP tool text and scripts/distill-sweep.mjs. The gate fails OPEN when vectors are unreadable (sqlite-vec absent), preserving prior behaviour. BAND_LOW stays at 0.70. scripts/audit-merges.mjs gains the same coverage metric as a post-hoc check plus a --band diagnostic that measures what a proposed clustering threshold would exclude.

**Alternatives:** Raise BAND_LOW from 0.70 to 0.75, which is what was initially requested: rejected on measurement. Over 1028 real merges, restricting to 2-source merges (where the single source pair IS the head-to-candidate comparison the band gates, so the reading is exact) the median gated pair sits at 0.75 and 48.5 percent fall below it. That is roughly half of all consolidation destroyed to address a defect measured in 1.6 percent of merges. Note the naive pooled figure was 62.7 percent, which overstates the cost because in a 3-source merge the tightest pair is often two non-head members that never had to clear the band. Post-hoc audit only, with no write-time guard: rejected because distill supersedes originals in the same pass, so by the time an audit sees the problem the sources are already flagged superseded. Ask the model to self-check its own merge: rejected as an extra LLM call per cluster that re-runs the judgement that already failed, when the embeddings needed are sitting in the database for free.

**Reason:** The coverage audit found merges where the rewrite ignored one of its sources entirely rather than combining them — worst observed case paired a shader-compilation-error memory with a JSON-only-output convention at merge-to-source cosine 0.34, and the rewrite silently discarded one. Identifier matching structurally cannot detect this: several affected merges scored 0 of 0 identifiers missing because the dropped source was pure prose with no code-like tokens. Cosine is essentially free here since embedMemory already stores normalized vectors keyed by rowid, so the check is a dot product with no model call. Gating at write time is what makes it non-destructive: the merge has been inserted and embedded but nothing has been superseded yet, so rejecting costs one row delete and leaves every original live for a later run to retry.
