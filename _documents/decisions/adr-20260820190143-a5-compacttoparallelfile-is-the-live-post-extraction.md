---
id: ADR-20260820190143-a5
title: compactToParallelFile is the live post-extraction shrink mechanism, superseding compactFileInPlace
type: adr
date: 2026-08-20
status: accepted
supersedes: ADR-015
tags: ["capture", "reflector", "vcc_compact", "data-safety"]
---

**Decision:** reflector.ts's post-extraction shrink of the raw transcript is compactToParallelFile (src/capture/vcc-bridge.ts:190), wired into reflector.ts:309-322. It writes a sibling .vcc-shrunk.jsonl file and never touches or overwrites the raw transcript JSONL. It shipped to production in commit 5ed360e without an ADR at the time this decision was made. ADR-015 (2026-07-26) disabled reflector.ts's call to the older compactFileInPlace() -- which overwrote the raw transcript JSONL in place with a lossy rendering -- and named 'fix rendering quality, then re-enable the in-place shrink' as the deferred precondition for restoring the mechanism. That precondition is now moot: compactFileInPlace is permanently dead code (the call remains commented out in reflector.ts with a do-not-re-enable note) and is superseded by compactToParallelFile, which was designed data-safe from the start (parallel file, source never touched) rather than needing a lossy-in-place risk mitigated. This ADR records that architectural shift so the decision trail reflects what reflector.ts actually calls in production, and closes the 're-enable the in-place shrink' question ADR-015 left open -- there is no in-place shrink left to re-enable.

**Alternatives:** (1) Keep compactFileInPlace as the mechanism to eventually re-enable, per ADR-015's original framing -- rejected implicitly by the compactToParallelFile design, since it never touches the source file and needed no rendering-quality precondition to be safe. (2) Delete the dead compactFileInPlace code outright -- not done in this pass; it remains commented out with a do-not-re-enable note rather than removed.

**Reason:** Closes a documentation gap flagged during FEAT-20260802190757-2d's design, where the feature was scoped against the stale premise that the in-place shrink still needed re-enabling. compactToParallelFile shipped to production (commit 5ed360e) without an ADR recording the shift; this backfills that record.
