---
id: ADR-017
title: nexus_distill sweep cursor: persistent distilled_at column replaces the fixed top-N candidate window
type: adr
date: 2026-07-26
status: accepted
supersedes: null
tags: ["distill", "schema-migration", "pagination", "mcp", "memory-lifecycle"]
---

**Decision:** Schema migration 11 adds a nullable memories.distilled_at column plus idx_memories_distilled_at. distillMemories stamps every candidate it pulls into a run with the run timestamp, before any work that can fail, so a crash mid-sweep does not cost progress already made. Candidate selection gains a cursor predicate: distilled_at IS NULL, widened to (distilled_at IS NULL OR distilled_at < :since) when the caller passes a new since option. eligibleRemaining is no longer derived as countEligibleSnapshot minus limit; it is measured by re-running countEligible under the cursor after the sweep, so it counts genuinely un-examined memories and strictly decreases to 0. The nexus_distill MCP tool exposes since and its description now states that a run finding 0 clusters is normal mid-sweep and is not a stop signal.

**Alternatives:** OFFSET or keyset pagination on (confidence, created_at): rejected because the ordering key mutates during a run (merges supersede rows, new consolidations are inserted), so an offset silently skips or repeats candidates, and neither survives a restart without the caller threading state. Caller-passed cursor state: rejected because every caller (MCP tool, scheduled task, skill) would have to persist it independently and a dropped session restarts the sweep from zero. A separate distill_runs table recording examined ids: rejected as heavier than one nullable column for the same guarantee. Leaving eligibleRemaining derived but documenting it as an estimate: rejected because callers already loop on it as a stop condition, so an estimate that can never reach 0 is a correctness bug, not a documentation gap.

**Reason:** Without a cursor every invocation pulled the identical top-limit window, so once that window had no clusterable pairs left all further runs were no-ops. Confirmed 2026-07-26 on the whole-DB scope: ten consecutive runs at limit 150 yielded 26 consolidated / 129 folded in, then froze at exactly 8445 eligible with 0 clusters on the last two runs; of 8595 eligible memories roughly 8445 were never examined at all. Marking every candidate examined (not just the ones folded in) is what makes successive runs disjoint. Measuring eligibleRemaining after the fact rather than deriving it also absorbs cluster members superseded from outside the pool and correctly counts newly created consolidations back in as un-examined; created is always strictly less than processed, so the count decreases on every run with work and callers looping until 0 terminate.
