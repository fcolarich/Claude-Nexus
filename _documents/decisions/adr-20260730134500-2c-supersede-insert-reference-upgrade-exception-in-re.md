---
id: ADR-20260730134500-2c
title: Supersede-insert reference-upgrade exception in reflect() dedup
type: adr
date: 2026-07-30
status: accepted
supersedes: null
tags: ["capture", "dedup", "reflector", "promotion-queue"]
---

**Decision:** reflect()'s dedup loop (findSimilarMemory + touchMemory) gains a scoped exception to claude-nexus's sticky first-classification rule. When a semantically-matched 'reference' candidate citing a real ADR/DDR id matches an existing 'decision'-type memory row (regardless of that row's promotion_target -- decision, none, or already-promoted), the pipeline inserts the reference as a new content-addressed row and marks the old decision row superseded_by = <new id>, both in one transaction, via a new isReferenceUpgrade() predicate. Previously dedup only ever touchMemory-reconfirmed the old decision row, leaving a permanent stale decision-type row generating human-review noise in nexus_promotion_queue for an ADR/DDR that was already formally recorded. ReflectResult gained a new 'upgraded: number' field.

**Alternatives:** In-place rewrite of the existing decision row's memory_type/body to the clean reference form was rejected: claude-nexus's content-addressed id invariant is id = sha256(memory_type + body), so rewriting type/body in place would silently change the row's identity and break every consumer keyed on that id. Leaving the sticky-first-classification rule fully intact (no exception) was rejected because it was the root cause of the permanent stale-decision-row noise this fix addresses.

**Reason:** Discovered via a whole-session-vs-incremental-window vcc_compact extraction validation experiment: decisions captured early (before their ADR exists) get memory_type=decision, promotion_target=adr; a later window correctly emits the clean reference-pointer form once the ADR is recorded, but dedup only touched the old row instead of upgrading it. Supersede-insert reuses the existing supersede-by-merge pattern already used by consolidate.ts/distill.ts, and every consumer (recall, export, decay, governance, promotion queue) already filters superseded_by IS NULL, so no new plumbing was needed. Design approved via flow-brainstorm-feature; full rationale and rejected alternatives at .flow/flow-toolkit/flow-brainstorm-feature/nexus-incremental-capture-fixes-20260730-0954/design.md.
