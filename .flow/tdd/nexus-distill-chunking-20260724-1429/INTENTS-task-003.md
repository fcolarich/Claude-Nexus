---
# INTENTS: task-003 — Add resolveScope helper with unit tests

## Task
{
  "id": "task-003",
  "title": "Add resolveScope helper with unit tests",
  "description": "In src/core/distill.ts add internal resolveScope(opts) -> ResolvedScope: if opts.project is set use it (literal 'global' -> global scope, else project slug); else if opts.cwd is set derive the slug using the same helper nexus_backfill uses (resolveProjectSlug from src/core/project-root.ts — confirm the exact export there); else scope = 'all'. Add unit tests in src/core/distill.test.ts covering all four branches (project slug, 'global', cwd-derived, none).",
  "files": ["src/core/distill.ts", "src/core/distill.test.ts", "src/core/project-root.ts", ".flow/tdd/nexus-distill-chunking-20260724-1429/impl-spec.md"],
  "depends_on": ["task-002"],
  "estimated_tokens": 9000,
  "complexity": "simple",
  "constraints": [],
  "risk": "low"
}

## Reviewer verdict
{
  "verdict": "PASS",
  "task_id": "task-003",
  "issues": [],
  "summary": "resolveScope correctly implements project-wins-over-cwd-wins-over-all precedence, treats literal 'global' specially, and degrades unresolvable cwd to 'all' without throwing (verified against resolveGitProjectRoot's catch-all and cwdToProjectSlug's null-on-too-short behavior in src/core/project-root.ts). All 4 required branches plus the project-wins-over-cwd interaction are covered by 5 non-trivial unit tests in src/core/distill.test.ts. No scope creep, no logic gaps."
}

## Meta
- timestamp: 2026-07-24T15:29:00Z
- model: sonnet (implementer), sonnet (reviewer)
- orchestrator verification: npx tsc --noEmit clean; npx vitest run src/core/distill.test.ts — 14/14 pass
---
