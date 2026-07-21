---
id: NOTE-001
title: MCP tool surface audit — 2026-07-21
date: 2026-07-21
tags: ["mcp", "audit", "tool-surface", "adr-011"]
---

## MCP Tool Surface Audit — 2026-07-21

**Tool count:** 20 current vs 18 at ADR-011 baseline (+2 since ADR-011).

ADR-011 (2026-07-02) added `nexus_remember_batch` as the 18th tool. Two tools were added after ADR-011 without a dedicated ADR: `nexus_promotions` and `nexus_mark_promoted` (promotion-classification feature). The file-map documents 18 tools and is stale.

### All 20 tools

**Retrieval**
- `nexus_search` — keyword + semantic hybrid search across memories and atoms
- `nexus_context` — multi-topic pinpoint fetch, merges memories and atoms into one response
- `nexus_recall` — decay-ranked memory recall budgeted to a token cap; session-start context
- `nexus_crossref` — vector + BM25 RRF cross-reference discovery across atoms
- `nexus_shared` — bulk load of global/shared atoms flagged load_at_init for session start

**Write / manage memories**
- `nexus_remember` — single-item memory write with content-addressed dedup
- `nexus_remember_batch` — batch write 1–50 memories in one transactional call (ADR-011)
- `nexus_verify` — reconfirm a memory is still accurate; resets decay clock
- `nexus_feedback` — record whether a recalled memory was useful (feeds ranking)
- `nexus_mark_promoted` — mark a memory as promoted to an external artifact (ADR/DDR/etc.)

**Cleanup / maintenance**
- `nexus_consolidate` — lightweight sweep: backfill embeddings, prune rejected, merge duplicates
- `nexus_distill` — heavy LLM-backed cluster-and-rewrite cleanup
- `nexus_backfill` — retroactively extract memories from pre-hook sessions
- `nexus_reindex` — force full re-index of all Claude knowledge files

**Observation / admin**
- `nexus_health` — diagnostics audit: broken refs, duplicates, orphans, missing frontmatter; includes stats summary
- `nexus_stats` — database statistics: atom/memory/link/session counts
- `nexus_sessions` — list sessions with status, project, branch, message counts
- `nexus_promotions` — list memories flagged as promotion candidates (read-only)
- `nexus_set_init` — toggle load_at_init flag on a global/shared atom
- `nexus_project` — all knowledge atoms for a specific project

### Grouping and consolidation candidates

1. **nexus_stats absorbed by nexus_health** — nexus_health already emits the same stats block. Callers who only need counts must call nexus_health and discard diagnostics. A `stats_only` flag or deprecation of nexus_stats would eliminate redundancy with low breaking-change risk. This is the clearest consolidation candidate.

2. **nexus_search vs nexus_context** — surface overlap is high (both fetch memories + atoms). nexus_search is query-string-driven; nexus_context is topics-array-driven with different call semantics. Distinct enough in practice that merging would complicate the schema without simplifying usage.

3. **nexus_promotions + nexus_mark_promoted** — natural read/write companion pair; no consolidation case.

4. **nexus_consolidate vs nexus_distill** — different cost profiles (cheap DB sweep vs LLM-heavy rewrite); keeping separate is correct.

5. **nexus_promotions + nexus_mark_promoted lack an ADR** — these two tools were added post-ADR-011 without a recorded decision. An ADR-015 covering the promotion-classification feature would close the documentation gap.

### Recommendation

**Revisit later.** At 20 tools the surface is navigable, groupings are functionally coherent, and no urgent consolidation case exists. The sole concrete candidate (nexus_stats into nexus_health) is low-risk but also low-urgency. Trigger re-evaluation if the count reaches 25+ or new tool pairs continue appearing without ADRs. File ADR-015 for the promotion tools as housekeeping.
