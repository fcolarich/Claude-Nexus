---
id: ADR-20260821130040-ea
title: Fuzzy skeleton-match fallback for cwd project-slug resolution
type: adr
date: 2026-08-21
status: accepted
supersedes: null
tags: ["project-identity", "cwd-resolution", "recall", "bash-windows-path-bug"]
---

**Decision:** resolveProjectFromCwd (src/core/project-root.ts) gains a third recovery tier after the exact-slug and short-name lookups both miss: strip all non-alphanumeric characters from the derived slug into a lowercase skeleton, and compare it against the same skeleton computed for every distinct known project slug (from atoms/sessions/memories). Accept the match only if exactly one known project shares that skeleton.

**Alternatives:** 1) Normalize/repair the cwd string at every call site before it reaches resolveProjectSlug — rejected, cannot enumerate every shell/tool that might mangle a Windows path upstream (e.g. a bash/WSL caller silently dropping backslashes). 2) Fail loudly when the derived slug has zero matches — rejected, nexus_recall/nexus_search are read paths used mid-session; a hard error is worse UX than silent recovery for a case that is provably recoverable. 3) Fuzzy match with a similarity threshold (e.g. edit distance) — rejected, exact skeleton equality is simpler, deterministic, and sufficient since path-mangling only drops separator characters, never alters alphanumeric content.

**Reason:** Discovered via a live nexus_recall call from a bash-flavored subagent: a Windows cwd (C:\Voodoo\Paper2) arrived with backslashes already stripped by the calling shell, producing a derived slug (C-VoodooPaper2) with zero rows in the DB, so nexus_recall silently returned no memories with no error surfaced to the caller or user, despite 986 relevant memories existing under the correct slug (C--Voodoo-Paper2). The mangled and correct slugs are identical once separators/dashes are stripped, so skeleton comparison recovers the correct project deterministically without needing to fix the upstream shell.
