---
# INTENTS: task-013 — Wire phase 5 (detectContradictions) call site into consolidateMemories (GATED)

## Task
{
  "id": "task-013",
  "title": "Wire phase 5 (detectContradictions) call site into consolidateMemories (GATED)",
  "files": ["src/core/consolidate.ts", "src/core/governance.ts", "src/core/llm.ts"],
  "depends_on": ["task-011", "task-012"],
  "risk": "high"
}

## Gate check
This is the final gated task — architecture.md KQ4's hard pre-merge gate (DDR-005 must
exist before any code touches detectContradictions or its consolidate.ts call site) is now
fully satisfied end to end.

## Reviewer verdict (Sonnet, full checklist)
{
  "verdict": "PASS",
  "summary": "Phase 5 wired as the final phase, order backfill->prune->merge->govern->detect confirmed. New haikuFn param additive/backward-compatible (confirmed against pre-existing callers in integration.test.ts and lifecycle.test.ts). ConsolidateResult fields named exactly as specified. governance.ts untouched. No schema changes. DDR-005 satisfied."
}

## Gemini second opinion
Unavailable a third time across this task chain (consistent model-access error for
google/gemini-2.5-flash in this environment). Treated as SKIP per routing protocol.
Manually addressed the three substantive concerns a second reviewer would raise:
1. Failure semantics — callModel (llm.ts) never rejects; it catches all provider errors
   and returns '' on failure, which detectContradictions then treats as an unparseable
   response and skips silently. detectContradictions itself wraps every per-pair haikuFn
   call in try/catch. So under the real default haikuFn, consolidateMemories's rejection
   behavior is unchanged from before this task in practice.
2. Live LLM call as the first network-calling phase — mitigated by the same error handling;
   worst case is added latency (bounded by extraction_models.yaml's timeout_ms per call,
   capped at MAX_PAIRS_PER_RUN=20 pairs), not a hang risk to the whole process.
3. Govern-before-detect ordering (governByHelpRate can change confidence, which
   detectContradictions's divergence pre-filter reads) — this is the explicit, deliberate
   sequencing specified in design.md ("govern by help-rate trend -> detect contradictions")
   and architecture.md's End-to-end section, not an oversight; detection intentionally
   reads the freshest post-governance confidence state.
No overarching transaction wraps all 5 phases, so a phase-5 failure (however unlikely)
cannot roll back phases 1-4's already-committed work, per the impl-spec's stated
edge-case requirement.

## Meta
- timestamp: 2026-07-22T01:45:00Z
- model: sonnet (implementer), sonnet (reviewer), gemini (unavailable/skip, manually addressed)
---
