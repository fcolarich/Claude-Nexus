# Claude Nexus Source Code Implementation

## URL / Path
C:\Fran\claude-nexus\src\ (core modules: recall.ts, reflector.ts, extract.ts, config.ts, project-root.ts, database.ts, mcp/server.ts)

## Summary

Claude Nexus's capture and recall pipeline implements a dual-phase architecture for cross-session memory. The **capture phase** (reflector.ts) reads new transcript windows, extracts memory candidates via Claude Haiku 4.5 (extract.ts), deduplicates semantically (cosine threshold 0.86), and inserts or merges into SQLite with auto-approval at confidence ≥0.85. The extraction enforces durable-knowledge-only via system prompt, normalizes ADR references, and classifies memories into 8 types, 6 promotion targets, and 4 decay classes (stable/architecture/api_contract/implementation).

The **recall phase** (recall.ts) uses dual-bank querying (project-scoped + global/shared memories) with budgeted ranking: `effectiveConfidence(m) × helpRate`, where helpRate = help_count / use_count (defaults 1.0). Load-at-init memories bypass confidence thresholds and sort first. Token estimation (4 chars/token) walks from full bodies until budget is exhausted, then switches to titles-only with an elision message. Semantic recall (recallByQuery) embeds the query, performs KNN retrieval with 0.55 min-similarity floor, and offers optional cross-encoder reranking (jina-reranker-v2-base-multilingual, local HTTP, disabled by default, threshold 0.2).

**Project identity resolution** (project-root.ts) uses `git rev-parse --git-common-dir` to find the canonical .git root, then converts to project slug via regex (spaces→hyphens, Windows colon→double-dash). This prevents subdirectory fragmentation: C:\Fran\project and C:\Fran\project\tools both map to the same slug.

**MCP server** (mcp/server.ts) exposes 18 tools including nexus_search (hybrid BM25+dense), nexus_recall (budgeted), nexus_context (multi-topic), and nexus_remember_batch (bulk writes). Per ADR-006, startup does not block on full indexing; MCP opens DB, runs migrations, and serves immediately. Indexing is delegated to the web server (60s refresh interval) to prevent event-loop blocking and SQLITE_BUSY contention that caused 33s hangs and MCP handshake timeouts.

**Database schema** (database.ts) includes 9 migrations managing: memories table with memory_type, confidence (0–1), decay_class, scope, review_status, promotion_target, help_count, use_count for ranking. SQLite WAL mode, FTS5 + sqlite-vec extensions, foreign keys enabled.

**Runtime config** (config.ts) reads extraction_models.yaml: embedding model defaults to Ollama mxbai-embed-large (1024-dim), extraction to Claude Haiku 4.5, recall max_tokens to 2000, capture auto-approve threshold to 0.85, semantic dedup threshold to 0.86.

## Key Claims

- Semantic deduplication uses cosine distance threshold 0.86 to prevent redundant memory storage (reflector.ts)
- Recall ranking formula is `effectiveConfidence × helpRate`, with load_at_init memories exempt from min-confidence gating (recall.ts, DDR-003)
- Auto-approval threshold is 0.85 confidence; merged memories are re-confirmed via touchMemory (reflector.ts, extract.ts)
- Git-root resolution prevents directory fragmentation: subdirectories of the same repository map to the same canonical slug (project-root.ts, ADR-013)
- MCP server startup does not block on full indexing; moved to web server to prevent 33s event-loop blocks (mcp/server.ts, ADR-006)
- Extraction enforces durable-knowledge-only system prompt and normalizes ADR citations to reference pointers to keep canonical documents current (extract.ts)
- Optional cross-encoder reranking via local jina-reranker-v2 (disabled by default, 50–100ms latency cost)
- Recall token budget walks from full memory bodies to titles-only with elision message when budget exceeded (recall.ts)
- Per-session deduplication in semantic recall prevents redundant injection of the same memory within a single session (recall.ts)

## Confidence Score: 0.92

**Rubric justification:** All claims trace directly to key_findings sections of the 7 source code files read during retrieval. Implementation details include specific file references (reflector.ts line/behavior, config.ts defaults, database.ts schema), decision rationale from ADRs (ADR-006, ADR-013), and exact parameter values (0.86 dedup threshold, 0.85 auto-approve, 0.55 min_similarity). Minor inference limited to connecting related components (e.g., how ranking formula connects to load_at_init behavior). No fabrication; all claims are direct paraphrases of key_findings.
