---
id: ADR-013
title: Git-repository-root resolution replaces raw-cwd string slugging for project identity
type: adr
date: 2026-07-05
status: accepted
supersedes: null
tags: ["project-identity", "git", "migration", "slug-resolution"]
---

**Decision:** Added src/core/project-root.ts exposing resolveGitProjectRoot() (shells to `git rev-parse --git-common-dir` to find the true repo root, collapsing worktrees onto their main checkout for free) and resolveProjectSlug() (composes it with the existing cwdToProjectSlug). All five live-cwd call sites (src/mcp/server.ts, src/web/server.ts, src/capture/runner.ts, src/capture/prompt-runner.ts, src/indexer/indexer.ts) were repointed to use it, eliminating a duplicated inline copy of the slug function that used to live in prompt-runner.ts. Added a new project_aliases table (migration 8 in src/core/database.ts) to record alias->canonical slug mappings. Added src/capture/project-migrate.ts (buildProjectAliases/applyProjectAliases/migrateProjects) plus a new `nexus migrate-projects` CLI command (dry-run/--apply pattern) that finds projects whose recorded slug does not match git-root resolution of a session's actual cwd, merges memories/atoms/sessions onto the canonical slug, dedupes via existing consolidateMemories, and re-exports. Also fixed exportAll() in src/capture/export.ts to prune stale ~/.claude/projects/<slug>/memory/ directories that no longer correspond to any live memory bucket (previously only pruned stale files within a bucket, never removed whole stale buckets). Subdirectories of the same git repo now share one project bucket instead of fragmenting into separate projects per cwd.

**Alternatives:** Further path-string regex hacks to cwdToProjectSlug (already patched once in bbe03dc3 for spaces/dots/worktree-suffixes) — rejected because it cannot solve subdirectory-unification and each future edge case would need another regex patch with no migration path for historical DB rows or on-disk export folders written before a fix.

**Reason:** cwdToProjectSlug's regex was fixed for spaces/dots/worktree-suffixes on 2026-06-28 (bbe03dc3), but historical DB rows and on-disk export folders written before that fix stayed fragmented forever with no migration path. Separately, subdirectories of the same git repo (e.g. a tools/ or experiments/* folder opened as its own cwd) were always treated as separate projects with no way to unify them. User approved via brainstorming that subdirectories of the same git repo should share one project bucket, which only a git-root-based approach can achieve. Already validated in production: migrated 153 memories, 90 sessions, deduplicated 134 near-identical pairs, and confirmed stale on-disk folders (space-variant duplicates, worktree-suffixed folders, orphaned subdirectory export folders) were pruned automatically as a side effect.
