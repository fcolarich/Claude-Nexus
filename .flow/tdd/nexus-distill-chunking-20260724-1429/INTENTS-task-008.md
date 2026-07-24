---
# INTENTS: task-008 — Add nexus_distill MCP input schema and forward the new params

## Task
{
  "id": "task-008",
  "title": "Add nexus_distill MCP input schema and forward the new params",
  "description": "In src/mcp/server.ts extend the nexus_distill tool input schema with project?, cwd?, limit?, dry_run? mirroring nexus_backfill. In the handler, normalize limit (default 200, clamp to 500), pass project/cwd/limit/dryRun through as DistillOptions to distillMemories(db, opts, embedFn, callFn). The tool must stay non-auto-allowed — do not add any allowlist entry, and dry_run must not change that. No test (thin forwarding controller; behavior covered by distill unit tests).",
  "files": ["src/mcp/server.ts", ".flow/tdd/nexus-distill-chunking-20260724-1429/impl-spec.md"],
  "depends_on": ["task-001"],
  "estimated_tokens": 17000,
  "complexity": "complex",
  "constraints": [],
  "risk": "high"
}

## Reviewer verdicts
Sonnet (attempt 1): NEEDS_REVISION — handler pre-clamped limit:0/negative to 1 before distillMemories saw it, bypassing distillMemories's own default-to-200 rule for that input range.
Sonnet (attempt 2, final): PASS — "Fix confirmed: nexus_distill handler now forwards limit untouched to distillMemories with no pre-clamp... distillMemories's own normalizeLimit is the sole authority... No new issues introduced."
Gemini (second opinion, required for high risk): SKIP — no Bash tool available to this subagent invocation to run scripts/gemini_review.py or capture a live git diff; it did a manual Read-based sanity check instead and found the code consistent with the described fix, but declined to fabricate a Gemini-backed verdict. Per flow protocol, SKIP proceeds normally.

## Meta
- timestamp: 2026-07-24T15:53:00Z
- model: sonnet (implementer), sonnet (reviewer x2), gemini (SKIP — env constraint)
- orchestrator verification: npx tsc --noEmit clean; npx vitest run src/mcp/server.test.ts — 17/17 pass (both before and after the fix)
---
