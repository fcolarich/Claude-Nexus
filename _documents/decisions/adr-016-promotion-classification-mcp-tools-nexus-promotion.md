---
id: ADR-016
title: Promotion-classification MCP tools (nexus_promotions, nexus_mark_promoted)
type: adr
date: 2026-07-26
status: accepted
supersedes: null
tags: ["mcp", "promotion", "housekeeping", "note-002"]
---

**Decision:** Two MCP tools implement the promotion-classification feature: nexus_mark_promoted marks a memory as promoted to an external artifact (ADR/DDR/skill/etc.), and nexus_promotions lists memories flagged as promotion candidates (read-only). Recorded here as accepted, already-shipped architecture to close a documentation gap -- both tools were added to the MCP surface after ADR-011 without their own ADR.

**Alternatives:** None evaluated at the time of original implementation; this ADR is a retroactive housekeeping record, not a live design decision.

**Reason:** NOTE-002 (2026-07-21 MCP tool surface audit) flagged these two tools as undocumented: tool count moved from 18 (ADR-011 baseline) to 20 with no ADR covering the +2. The audit found them to be a natural read/write companion pair with no consolidation case, so this ADR records the existing shape rather than proposing a change.
