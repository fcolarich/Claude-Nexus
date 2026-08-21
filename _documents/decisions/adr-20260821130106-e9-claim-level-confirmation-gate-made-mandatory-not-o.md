---
id: ADR-20260821130106-e9
title: Claim-level confirmation gate made mandatory (not opt-in) on consolidateMemories and distillMemories
type: adr
date: 2026-08-21
status: accepted
supersedes: null
tags: ["claims", "dedup", "distill", "consolidate", "structured-memory"]
---

**Decision:** src/core/consolidate.ts's confirmDuplicateFn param on consolidateMemories now defaults to confirmMemoryDuplicate bound to the caller's own haikuFn, instead of defaulting to undefined (skippable). The if (confirmDuplicateFn) conditional around the merge gate was removed -- the confirmation gate now always runs. src/core/distill.ts's contradictionGuardFn param on distillMemories received the identical treatment (default confirmMemoryDuplicate bound to callFn, conditional removed). This makes ADR-20260820230137-dc's original opt-in design point (default undefined = gate skippable, callers must explicitly wire confirmMemoryDuplicate) mandatory instead: the claim-level dedup confirmation gate cannot be bypassed by any caller, production or test.

**Alternatives:** (1) Leave the gate opt-in as ADR-dc originally shipped it -- rejected because all three production call sites (mcp/server.ts, web/server.ts, scripts/distill-sweep.mjs) were already wiring confirmMemoryDuplicate explicitly, meaning the opt-in default only left a silent footgun for any future or test call site that omitted it, with no live caller ever benefiting from the skip path. (2) Keep opt-in but add a lint/test rule forcing every call site to pass it explicitly -- rejected as more moving parts for the same guarantee a mandatory default gives for free.

**Reason:** ADR-dc's live validation already showed the gate correcting real false merges (0 -> 14 correct merges once wired), and every production call site already wired it, so an optional/skippable default was strictly weaker than the code's actual behavior for no benefit -- it only meant a future caller (or a test) could silently regress to raw-cosine-only merging by omitting the param. Making it mandatory closes that gap. Tests in distill.test.ts, consolidate.test.ts, lifecycle.test.ts, and integration.test.ts were updated to stub the now-mandatory gate explicitly. Full suite (606 tests) passes; tsc build clean; dist/ rebuilt. ADR-20260820230137-dc is append-only and was not edited; this ADR records that its opt-in framing is now outdated.
