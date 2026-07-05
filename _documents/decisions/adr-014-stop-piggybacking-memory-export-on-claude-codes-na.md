---
id: ADR-014
title: Stop piggybacking memory export on Claude Code's native auto-memory directory
type: adr
date: 2026-07-05
status: accepted
supersedes: null
tags: ["capture", "export", "recall", "hooks"]
---

**Decision:** capture.export_dir no longer points at ~/.claude/projects/<project>/memory (Claude Code's own built-in auto-memory directory, auto-loaded in full into every session's system context). It now falls back to the code default, a Nexus-owned sandbox: ~/.claude/memories/exports. This reverses an earlier informal cutover that was never itself recorded as an ADR -- only described in a code comment in src/capture/export.ts (now corrected). A one-time cleanup also deleted the already-populated memory/ folders under ~/.claude/projects/<project>/ across all ~29 projects this Nexus install was tracking (including a _global bucket with 2717 files), since Nexus exclusively owns that memory/ subdir. New exports land at ~/.claude/memories/exports/<project>/memory/ instead.

**Alternatives:** (1) Keep the harness-path export but cap MEMORY.md to a curated top-N -- rejected as more complex than needed, and still leaves a second, weaker recall path duplicating prompt-runner. (2) Keep as-is -- rejected: the full unfiltered dump had already grown to 114+ memories in this project alone and exceeded Claude Code's 24.4KB per-file load ceiling (triggering silent truncation), and some other projects tracked by this Nexus install had 1000+ exported files piling into their sessions.

**Reason:** ADR-009 already established that prompt-runner.ts (UserPromptSubmit hook) provides per-prompt, relevance-floored semantic recall directly from the DB -- a strictly better mechanism than an unranked, unfiltered full-memory dump loaded once at session start regardless of relevance. The harness-path export was redundant with that mechanism and had an unbounded growth problem (nothing scheduled nexus_consolidate/nexus_distill, so export size only increased). The markdown mirror itself is not removed -- exportAll() still runs on every reflect/backfill/migrate cycle -- it just no longer targets a directory Claude Code auto-loads. No retrieval path is affected: nexus_recall, nexus_search, and the web dashboard all query the DB directly and never read the exported markdown.
