---
id: FEAT-003
title: Non-git-repo fallback for project-slug resolution reintroduces subdirectory fragmentation
status: planned
date: 2026-07-26
links: ["ADR-013"]
tags: ["project-root", "slug-resolution", "governance"]
---

resolveGitProjectRoot() in src/core/project-root.ts falls back to the raw, unmodified cwd when git is unavailable, times out, or the cwd is not inside a git repository (confirmed by direct code read - the catch block returns cwd unchanged). This reintroduces exactly the subdirectory-fragmentation problem ADR-013 fixed for the git case: two subdirectories of the same non-git project resolve to two different slugs instead of one canonical slug. Needs a decision on whether to build a non-git resolution heuristic (e.g. nearest package.json/.git-sibling) or explicitly document the fallback as an accepted limitation. Sourced from claude-nexus-improvements-synthesis.md item 10.
