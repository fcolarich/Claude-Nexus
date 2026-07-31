---
id: DDR-20260731141054-ff
title: Diff-before-write memory export to avoid churn
type: ddr
date: 2026-07-31
status: accepted
supersedes: null
tags: ["export", "capture", "performance", "git-churn"]
---

**Decision:** exportAll() in src/capture/export.ts computes the expected filename set for a bucket up front, reads existing file content and skips writeFileSync when the new content is byte-identical to what is on disk (applies to both per-memory .md files and the per-bucket MEMORY.md index), and only deletes .md files that are no longer in the expected set. This replaces the prior blanket delete-all-then-rewrite-all of every .md file in a touched bucket on every export.

**Alternatives:** Keep the delete-all-then-rewrite-all approach (simpler code, but rewrites every file on every export run regardless of content change, causing unnecessary mtime/git churn across the whole bucket). Or hash-compare instead of full content compare (adds a dependency/complexity for no real benefit at this file scale).

**Reason:** The old approach caused unnecessary mtime and git churn for every memory in a touched bucket even when a memory content had not changed, since it deleted and rewrote all .md files unconditionally on every export. Diffing content before writing, and only deleting genuinely stale files, keeps the export idempotent with respect to unchanged memories.
