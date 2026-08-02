---
id: ADR-20260802200851-8e
title: Capture is gated on session origin, and content-tool output is scrubbed from the window
type: adr
date: 2026-08-02
status: accepted
supersedes: null
tags: ["capture", "memory-quality", "noise-reduction"]
---

**Decision:** Memory capture is refused for whole sessions based on their ORIGIN, decided by one classifier in src/capture/origin.ts: a scheduled-task name denylist, a command/skill denylist matched on the trailing segment after the last colon so plugin-namespaced names match, and the NEXUS_NO_CAPTURE environment variable. The gate lives inside reflect() rather than in its callers, because both src/capture/runner.ts and src/web/server.ts call reflect() and a caller-level gate would leave the web path open. Separately, successful tool_result bodies for content-bearing tools (Read, Grep, Glob, WebFetch, search_code) are blanked in the RAW JSONL lines by src/capture/transcript.ts, while tool ERROR bodies are preserved because tool failures are where tool_quirk memories come from. scripts/purge-origin.mjs applies the same classifier retroactively, dry-run by default, taking a VACUUM INTO snapshot before any delete.

**Alternatives:** Project-slug denylist, rejected because Automatic-Encyclopedias and claude-nexus both hold genuine engineering memories alongside the noise. Content-based LLM classification of individual memories, rejected as unreliable and unable to separate a book aphorism from a real architectural insight. Filtering only the condensed window.text, rejected after finding that reflect() feeds window.rawLines to VCC and uses VCC output as the extraction text, which would have made the filter dead code on the normal path. A byte-bounded transcript head scan, rejected because injected CLAUDE.md and recalled-memory blocks push origin markers past a 40KB window, after which the classifier fails open silently.

**Reason:** Measured noise, not speculation. Over roughly 32 hours the database gained 393 memories across 12 projects in three identifiable classes: genuine technical facts, self-referential distill-audit commentary, and non-technical aphorisms harvested from books and external repositories. A retroactive pass over the live database confirmed the distribution: 154 memories from harvest-knowledge, 63 from the distill-audit scheduled task, and 59 from extract-knowledge. The live gate fails OPEN so a classifier bug can never silently stop capture; the purge fails CLOSED so a memory whose transcript is missing is never deleted.
