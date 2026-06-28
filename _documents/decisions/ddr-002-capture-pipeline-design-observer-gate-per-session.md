---
id: DDR-002
title: Capture pipeline design: Observer gate + per-session cursor for cheap idempotency
type: ddr
date: 2025-01-01
status: accepted
supersedes: null
tags: []
---

**Decision:** The Reflector reads only transcript lines added since `sessions.last_reflected_index` (the per-session cursor). Before calling the LLM, an Observer gate checks for signal: the window must have ≥1 user message, ≥4 exchanges, a tool error, or a correction/preference marker phrase — trivial windows skip the LLM call entirely. The capture hooks (`Stop` / `PreCompact` / `SessionEnd`) always spawn `runner.js` detached and exit 0 — a capture failure never disrupts a session. Recall (`load-runner.js`) is registered as a direct `SessionStart` command (needs stdout for `additionalContext`), runs synchronously, best-effort.

**Alternatives:** Session-level dedup only (hash whole transcript) — coarser than the cursor; doesn't handle incremental captures during long sessions. Blocking capture — unacceptable; session hooks must not stall Claude Code startup/shutdown.

**Reason:** The cursor + Observer gate means frequent `Stop` events (e.g. from tool calls) are nearly free. The detached spawn pattern isolates capture failures from session lifecycle. The asymmetry between capture (detached) and recall (direct command) reflects their different latency requirements.
