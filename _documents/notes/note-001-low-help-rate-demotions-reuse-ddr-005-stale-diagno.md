---
id: NOTE-001
title: Low-help-rate demotions reuse DDR-005 stale-diagnostics surfacing pattern
date: 2026-07-22
tags: ["memory-governance", "diagnostics", "decay", "consolidate"]
status: open
---

governByHelpRate (src/core/governance.ts) writes a diagnostics row (type='stale', reason='low_help_rate') per demoted memory, mirroring detectContradictions' reason='contradiction' rows recorded in DDR-005. Both share the same 'stale' type -- decay.ts:flagStaleMemories' periodic DELETE FROM diagnostics WHERE type='stale' wipes both kinds. Only the contradiction pass has a self-heal re-derivation step (selfHealContradictionDiagnostics); low-help-rate demotion diagnostics are NOT re-derived if lost -- they are pure history/audit trail, not backed by a durable memory_links row like contradictions are, so there is nothing to self-heal from. This was a deliberate follow-up (commit 224f1ac) extending the already-recorded DDR-005 surfacing mechanism, not a new design decision, so no new DDR was written. Future changes to decay.ts's stale-diagnostics DELETE must account for three now-coexisting reasons under type='stale': decayed-memory rows, reason='contradiction', and reason='low_help_rate'.
