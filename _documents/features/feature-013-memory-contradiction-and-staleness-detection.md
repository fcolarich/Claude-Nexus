---
id: FEAT-013
title: Memory contradiction and staleness detection
status: implemented
date: 2026-07-26
links: []
tags: ["memory", "governance", "knowledge-vault"]
---

governance.ts's detectContradictions runs a heuristic pre-filter plus bounded Haiku confirmation to surface (not silently resolve) contradictory or stale memory pairs via diagnostics rows, gated behind DDR-005. Closes the governance-gap finding from web research (source-3.md) that flagged this as commonly missing across production agent-memory systems -- Nexus already has it.
