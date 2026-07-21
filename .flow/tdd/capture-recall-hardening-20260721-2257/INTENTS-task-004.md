---
# INTENTS: task-004 — Record consolidate rewrite NO-GO comment

## Task
{
  "id": "task-004",
  "title": "Record consolidate rewrite NO-GO comment",
  "description": "Add a header comment on consolidateMemories() in src/capture/consolidate.ts recording the Q4 rewrite NO-GO: LLM body-compaction/rewrite evaluated and declined — embed + prune-rejected + merge-by-supersede is sufficient at current per-bucket volume; downstream index bloat is handled by the MEMORY.md cap in export.ts, not by rewriting bodies; no schema exists to record rewrite provenance. No behavioral change, signature unchanged. Acceptance: SC-3 — go/no-go documented unambiguously in code; consolidate tests green.",
  "files": ["src/capture/consolidate.ts"],
  "depends_on": ["task-002"],
  "estimated_tokens": 2000,
  "complexity": "simple",
  "constraints": ["Q4"],
  "risk": "low"
}

## Correction applied
tasks.json/impl-spec.md named `src/capture/consolidate.ts`, which does not exist
anywhere in repo history. The real `consolidateMemories()` lives in
`src/core/consolidate.ts` (confirmed via `git log --all` + grep). The orchestrator
discarded the first implementer's mistaken stub file at the wrong path (left inert,
untracked, never git-added) and placed the Q4 NO-GO header comment above the real
function in `src/core/consolidate.ts` instead.

## Reviewer verdict
{
  "verdict": "PASS",
  "task_id": "task-004",
  "issues": [
    {
      "severity": "nit",
      "location": "task-004 spec / files array",
      "note": "Task listed files as [\"src/capture/consolidate.ts\"] but consolidateMemories lives in src/core/consolidate.ts. Corrected by orchestrator before implementation.",
      "failure_type": "spec_gap"
    }
  ],
  "summary": "Q4 NO-GO comment correctly placed above the real consolidateMemories() in src/core/consolidate.ts, covers all three rationale points, no behavioral change. 9/9 regression tests (integration.test.ts, lifecycle.test.ts) pass."
}

## Meta
- timestamp: 2026-07-22T00:06:00Z
- model: sonnet (implementer), sonnet (reviewer)
- verification: `npx vitest run src/integration.test.ts src/core/lifecycle.test.ts` -> 9 passed, 9 total.
---
