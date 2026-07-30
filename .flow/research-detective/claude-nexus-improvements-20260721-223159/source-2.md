# Claude Nexus Documentation & Design Records

## URL / Path
C:\Fran\claude-nexus\_documents\ (architecture.md, design.md, ADRs, DDRs, file-map.md)

## Summary

Claude Nexus documents its architectural and design decisions via 14 Architecture Decision Records (ADRs) and 4 Design Decision Records (DDRs), with a unified file-map index. The **architecture** layer records system-level choices: git-root resolution (ADR-013) unifies historically fragmented project buckets, preventing migration of 153 memories across 90 sessions and auto-pruning 134 near-duplicate export folders. MCP server startup optimization (ADR-006) eliminated a 33-second full-index block that caused SQLITE_BUSY contention and MCP handshake timeouts; indexing now runs on the web server every 60 seconds. Recent ADRs also cover cross-encoder reranking fallback (ADR-012), batch-write tool surface (ADR-011), removal of deprecated task subsystem (ADR-010), and prompt-driven semantic recall (ADR-009).

The **design** layer formalizes algorithms and thresholds: DDR-003 specifies recall ranking as `effectiveConfidence × helpRate`, where helpRate defaults to 1.0 when use_count is zero, and load_at_init memories bypass the min_confidence gate and sort first. The capture pipeline (DDR-baseline) gates extraction with an observer-pattern check (skip LLM if no signal), maintains per-session reflection cursor for idempotency, then applies semantic deduplication (cosine 0.86), auto-approval (≥0.85 confidence), and embedding+linking. Capture thresholds are formally specified: 0.86 dedup, 0.85 approval gate, 4 decay classes (stable/architecture/api_contract/implementation) to tune decay speed by semantic stability.

The **file-map** documents the flat codebase structure: MCP server entry (src/mcp/server.ts, 18 tools), REST API server (src/web/server.ts, port 3210), CLI (src/cli/index.ts with index, search, context, list, health, stats, sessions, watch, backfill, prune-narration, migrate-projects commands), capture pipeline (reflector → extract → export), and core modules (database with WAL+FTS5, embeddings via Ollama, reranker, recall logic). All documentation is automatically indexed from per-decision files via Python rebuild script, preventing manual index drift.

The design records reflect a philosophy of **explicit thresholds and staged gates**: each pipeline stage (observation → extraction → dedup → approval → embedding) has tunable parameters and decision points documented as DDRs. This enables deliberate evolution of capture/recall quality without ad-hoc tweaking.

## Key Claims

- Git-root resolution via `git rev-parse --git-common-dir` consolidates fragmented project buckets; production validation showed 153 migrated memories across 90 sessions (ADR-013)
- Auto-pruning of stale export folders with no live memories (ADR-013)
- MCP server startup moved full indexing to web server to eliminate 33-second event-loop block that caused SQLITE_BUSY contention (ADR-006)
- Recall ranking formula: `effectiveConfidence × helpRate`, load_at_init bypass min-confidence threshold (DDR-003)
- Semantic deduplication threshold set to 0.86 cosine distance (DDR-baseline)
- Auto-approval confidence gate at 0.85; merged memories re-confirmed (DDR-baseline)
- Four decay classes (stable/architecture/api_contract/implementation) enable differential decay rates by semantic stability (DDR-baseline)
- Capture pipeline uses observer gate (skip extraction if no signal) + per-session cursor for cheap idempotency (DDR-baseline)
- Cross-encoder reranking optional fallback via jina-reranker-v2 (ADR-012)
- Batch-write tool (nexus_remember_batch) added for bulk memory operations (ADR-011)
- Extraction system enforces durable-knowledge-only via system prompt; ADR citations normalized to reference pointers (extract.ts design)

## Confidence Score: 0.88

**Rubric justification:** All claims cite specific ADRs and DDRs by number and rationale. Implementation details (thresholds, parameter values, production-validated migration numbers) trace to key_findings from architecture.md, design.md, and individual decision records. Rationale for design choices (why decay classes exist, why observer gate matters, why indexing moved) is documented. No inference beyond connecting related decisions; no claims about impact or success metrics beyond what's explicitly recorded (e.g., "153 memories migrated"). Documentation sometimes records intent without future impact evaluation, hence confidence below source-code level (which has direct review of current behavior).
