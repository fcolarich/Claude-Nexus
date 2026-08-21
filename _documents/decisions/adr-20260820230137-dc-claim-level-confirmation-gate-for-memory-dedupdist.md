---
id: ADR-20260820230137-dc
title: Claim-level confirmation gate for memory dedup/distill: consolidateMemories and distillMemories, calibrated live
type: adr
date: 2026-08-20
status: accepted
supersedes: null
tags: ["claims", "dedup", "distill", "consolidate", "calibration", "structured-memory"]
---

**Decision:** Added memory-dedup-confirm.ts confirmMemoryDuplicate() as an opt-in claim-level confirmation gate: consolidateMemories gained an optional confirmDuplicateFn param (undefined default = unchanged raw-cosine behavior), distillMemories gained an optional contradictionGuardFn param (undefined default = unchanged embedding-only clustering). Both production call sites (mcp/server.ts, web/server.ts, scripts/distill-sweep.mjs) now pass confirmMemoryDuplicate bound to whichever model callFn distillation/consolidation itself already uses. Decomposition is lazy and persisted: a candidate memory is only decomposed into claims the first time it is flagged as a dedup/cluster candidate (claims_extracted_at gate), and those claims are reused for free on every later candidacy, so cost amortizes across repeated consolidation runs instead of a full-corpus upfront sweep.

**Alternatives:** (1) Leave consolidateMemories/distillMemories on raw cosine similarity alone, with no confirmation step. (2) Full corpus-wide claim decomposition ahead of time, decoupled from candidacy. (3) Reuse claim-dedup.ts own 0.98/0.92 similarity bands (classifyDedupBand) for the cross-memory coverage check.

**Reason:** consolidateMemories duplicate merge was a single raw cosine threshold with NO confirmation step at all -- no fuzzy blend, no identifier veto -- on a bigger unit (whole memories) than claims, which already had a full precision treatment. A first live run (0.98/0.92 bands reused from claim-dedup.ts, alternative 3) found 0 confirmations out of roughly 30 real candidate pairs including obvious duplicates -- those bands are calibrated for claims extracted from the SAME source text in one pass, which naturally has tighter textual overlap than claims independently paraphrased across two separately-authored memories (real duplicate pairs measured 0.78-0.91 combined, never clearing 0.92). Fixed with a dedicated CLAIM_MATCH_THRESHOLD=0.78 and a looser zero-overlap identifiersConflict veto (vs claim-dedups any-difference veto, which also proved too strict here for the same independently-authored-text reason). Re-validated live against the real corpus with a pre-run snapshot: 0 -> 14 correct merges confirmed by spot-check, 0 false merges. Alternative 2 (full corpus decomposition) was explicitly rejected earlier this session after measuring that claim-level retrieval underperforms memory-level retrieval (DDR-20260820230103-b4) -- decomposition only earns its cost when triggered by real candidacy, not run speculatively over the whole corpus.
