---
id: DDR-006
title: Automatic memory-usefulness feedback via retrospective capture-runner pass
type: ddr
date: 2026-07-22
status: accepted
supersedes: null
tags: ["memory-governance", "feedback", "capture-pipeline", "hooks"]
---

**Decision:** Judge whether recalled memories actually helped a session retrospectively, at Stop/PreCompact/SessionEnd, by extending the existing detached capture runner (src/capture/runner.ts) with a step after reflect(): read the session's recall-state file for injected-but-unevaluated memory ids, ask Haiku (via a new feedback-judge.ts, mirroring governance.ts's detectContradictions shape) for one batched per-memory verdict against the full transcript, call recordFeedback(db, id, helped) per verdict, and mark those ids evaluated in the recall-state file so a later firing in the same session doesn't re-judge them. No schema change: the recall-state file (~/.claude/memories/.recall-state/<session_id>.json, written by prompt-runner.ts) is extended from a flat string[] of injected ids to {id, evaluated: boolean}[], serving as both the injected-id tracker and the evaluated-state cursor.

**Alternatives:** Per-prompt or per-N-tool-call usefulness checks were rejected: usefulness is often only provable many turns after a memory is injected, and checking on every turn adds cost/noise for no benefit. A single holistic session verdict ('did recalled memories help at all') was rejected: it throws away per-memory distinguishability that a batched-but-per-id judgment can still capture in one Haiku call. A new standalone hook script (separate from nexus-capture.mjs) was rejected: it would double the detached-process spawn per Stop/PreCompact/SessionEnd firing for no real separation-of-concerns benefit, since this is one more step in the same pipeline, not a different trigger. A new sessions-table DB column (mirroring last_reflected_index) was considered for evaluated-state tracking but rejected in favor of extending the recall-state file, since the signal is really about which memory ids were injected (a concept the file already owns), not transcript line offsets.

**Reason:** Populates use_count/help_count (and therefore governByHelpRate, DDR-003's recall-ranking consumer) with real signal instead of relying on a manual nexus_feedback call that in practice is never invoked mid-session. Reuses existing infrastructure end to end: the recall-state file prompt-runner.ts already writes, the detached best-effort process runner.ts already runs, and the callModel/HaikuFn injection pattern governance.ts's detectContradictions already established. Retrospective judgment gets full transcript hindsight for the same one-call-per-firing cost the capture pipeline already pays, and never blocks or affects the live session since it runs inside the same non-blocking detached process as reflect().
