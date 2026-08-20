---
id: FEAT-20260802190757-2d
title: Fix vcc_compact rendering quality and re-verify before re-enabling reflector's post-extraction shrink
status: implemented
date: 2026-08-02
links: ["ADR-015", "external:LLM_Workflow_Optimization@9eb5a97", "external:LLM_Workflow_Optimization@71916ca", "external:LLM_Workflow_Optimization@fd981c6", "external:LLM_Workflow_Optimization@6bf9f37", "ADR-20260820190143-a5"]
tags: ["capture", "reflector", "vcc_compact", "citation-rendering"]
---

Re-scoped during design: the original premise (fix vcc_compact rendering quality, then re-verify before re-enabling reflector.ts's post-extraction in-place shrink) was stale. `compactFileInPlace` — the in-place shrink ADR-015 disabled — is permanently dead code, already superseded in production by `compactToParallelFile` (src/capture/vcc-bridge.ts:190, wired into src/capture/reflector.ts:309-322, shipped in commit 5ed360e before this feature was designed). `compactToParallelFile` never touches the raw transcript, so ADR-015's original data-safety blocker does not apply to the live code path — there is no in-place shrink left to re-enable.

The real remaining risk was rendering quality alone: vcc_compact's Bash/PowerShell tool citations rendered opaquely (command only, or nothing at all for PowerShell), silently dropping result content that `nexus_search_session`'s parallel-file search relies on — with no fallback trigger since the shrunk file wasn't empty or unreadable, just incomplete.

Fixed by extending `citation.py` in the separate `LLM_Workflow_Optimization` repo (`Local Marketplace Subproject/plugins/flow-shared/modules/vcc_compact/citation.py`) to show a bounded "→ N lines" result citation for Bash, matching the existing Read/Grep pattern, and adding a dedicated PowerShell branch that previously didn't exist at all. Committed on that repo's main branch (commits 9eb5a97, 71916ca, fd981c6, 6bf9f37) — a different repo with no shared ADR/feature tracking, hence the `external:` link prefix above. Nothing to implement in claude-nexus itself for this feature — documentation only.
