---
id: ADR-018
title: Distill merge budget scales with cluster size; identifiers are verbatim-protected
type: adr
date: 2026-07-26
status: accepted
supersedes: null
tags: ["distill", "prompt-design", "data-integrity", "memory-lifecycle", "verification"]
---

**Decision:** MERGE_PROMPT becomes mergePrompt(clusterSize), replacing the flat "body: 1-4 self-contained sentences" with a budget of clusterSize * 3 sentences, plus a non-negotiable rule that every identifier (file names and paths, function/script/class names, config keys, CLI flags, shader keywords, numbers, versions, URLs) is reproduced verbatim and that a longer body always beats an omitted identifier. The same identifier rule is added to SANITIZE_PROMPT, which rewrites a memory in place and could drop specifics the same way. MAX_CLUSTER drops 4 to 3. scripts/audit-merges.mjs is added as the verification gate: it samples real merges, extracts code-like identifiers from the superseded originals, and reports any absent from the merged body; scripts/check-merge-model.mjs gains two identifier-dense cases built from observed failures.

**Alternatives:** Keep the flat sentence cap and accept the loss: rejected, distill sets superseded_by on the originals so a dropped identifier is permanent. Blame the local model and switch back to Haiku: rejected on measurement, Haiku lost 25.5 percent of identifiers against gemma3 33.2 percent under identical rules, so the model was never the cause. Stop superseding originals and keep them live alongside the merge: rejected as defeating the purpose of distill and inflating the recall corpus. Lower MAX_CLUSTER alone without touching the prompt: rejected as insufficient, even two-memory clusters were losing identifiers under the flat cap.

**Reason:** An audit of 678 real merges on 2026-07-26 found roughly 30 percent of code-like identifiers silently dropped. Concrete losses included an entire script inventory (batch_process.py, route_book.py, filter_batches.py, consolidate_topics.py, merge_shared_kb.py, routing-cache.json, book-queue.json) and a set of shader keywords with a recipe path (_ALPHATEST_ON, _ALPHABLEND_ON, _ALPHAPREMULTIPLY_ON, _SrcBlend/_DstBlend/_ZWrite, RCP-vfx-004). The root cause was that the prompt simultaneously demanded 1-4 sentences and that nothing be dropped, which is unsatisfiable for information-dense clusters; models obeyed the cap. The original 4-case model gate missed this because synthetic clusters carried about 4 identifiers while real memories carry 20-46. After the fix, identifier loss measured 4.8 percent with 35 of 40 sampled merges losing nothing, against 25.5-33.2 percent before under the same extraction rules. This flaw predates the sweep cursor of ADR-017; the broken cursor had been throttling distill to 26 merges historically, which hid the loss until the cursor fix let distill run at scale.
