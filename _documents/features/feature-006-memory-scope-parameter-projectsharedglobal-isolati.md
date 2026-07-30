---
id: FEAT-006
title: Memory scope parameter (project/shared/global isolation)
status: implemented
date: 2026-07-26
links: []
tags: ["memory", "scope", "knowledge-vault"]
---

scope: z.enum(['global','shared','project']) is exposed as a caller-settable parameter on nexus_remember, nexus_remember_batch (item + top-level default), and as a filter on nexus_search (mcp/server.ts). Confirmed by direct grep during the 2026-07 improvements research -- multi-tenant memory isolation across agents/subagents sharing a project is already handled, matching knowledge-vault atoms Memory Scope Parameter (ATOM-382) and Dual-Scope Memory Architecture (ATOM-561).
