---
id: ADR-015
title: Disable vcc post-extraction shrink in reflector.ts pending rendering-quality fix
type: adr
date: 2026-07-26
status: accepted
supersedes: null
tags: ["capture", "reflector", "vcc", "data-safety"]
---

**Decision:** reflector.ts no longer calls vcc.compactFileInPlace() after extraction. The call is commented out with an explicit do-not-re-enable-without-reverification note; sessions.vcc_shrunk_at is left unset until the mechanism is restored.

**Alternatives:** (1) Keep calling compactFileInPlace() as before - rejected, it overwrites the only copy of the raw transcript JSONL in place with a lossy rendering. (2) Fix vcc_compact rendering quality first, then re-enable - deferred; not done in this pass, tracked as the re-enable precondition. (3) Write the compacted output to a separate file instead of in place - not evaluated in this pass.

**Reason:** A review found real information loss in vcc_compacts rendering: opaque Bash/PowerShell citations and small-but-critical tool results get dropped when not restated in prose. Since compactFileInPlace() destroys the only copy of the raw transcript irreversibly, running a known-lossy renderer against it in place is unacceptable until the renderer is fixed and re-verified.
