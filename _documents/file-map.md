# Claude Nexus — File Map

Short summary of the important files and folders in this project, so an agent can navigate without scanning everything.
Maintained via the `update-file-map` skill.

## Entry points

| File | Role |
|------|------|
| `src/mcp/server.ts` | MCP server — 20 tools exposed over stdio transport (knowledge, recall, search, project/session management); see NOTE-002 for the full tool audit |
| `src/web/server.ts` | Express REST API server, port 3210; serves built dashboard from dist-frontend/ |
| `src/cli/index.ts` | CLI entry point — index, search, context, list, health, stats, sessions, watch, backfill, prune-narration, migrate-projects |
| `hooks/hooks.json` | Claude Code hook manifest — wires UserPromptSubmit (recall) and Stop/PreCompact/SessionEnd (capture) |

## Key files

| File | Role |
|------|------|
| `src/core/database.ts` | SQLite init, migrations, schema_version management |
| `src/core/recall.ts` | Memory retrieval — bulk decay-ranked recall (recallMemories, for MCP/web) + prompt-driven semantic recall (recallByQuery) |
| `src/core/embeddings.ts` | Embedding generation via Ollama mxbai-embed-large |
| `src/core/reranker.ts` | Cross-encoder reranking client for the local-reranker HTTP daemon (jina-reranker-v2-base-multilingual); wired into recallByQuery's KNN floor (ADR-012) |
| `src/core/config.ts` | Reads extraction_models.yaml; provides runtime config with sane defaults |
| `src/core/project-root.ts` | Project identity resolution — `resolveGitProjectRoot()` (git-common-dir lookup, collapses worktrees onto main checkout) composed with `cwdToProjectSlug()` via `resolveProjectSlug()`; the one function every live-cwd call site uses (ADR-013). Non-git cwds fall back to raw-cwd slugging with no subdirectory unification — accepted limitation, since project policy assumes real projects are git repos; see `.flow/tdd/nongit-slug-fallback-20260808-1513/design.md`'s Non-goals/Key Questions for rationale. Known gap: the narrow home-dir/drive-root noise-cwd exclusion added in `origin.ts` for this feature does not catch a custom-parent-folder noise cwd (e.g. `C:\SomeParentFolder`, neither the OS home dir nor a drive root) — flagged as a known gap rather than filed as a separate feature, per the same design.md's Non-goals and Key Questions sections. |
| `src/core/governance.ts` | consolidateMemories() phases 4-5: `governByHelpRate` (confidence demote/reinforce by observed help-rate) and `detectContradictions` (heuristic pre-filter + bounded Haiku confirmation, surfacing-only via `diagnostics` rows, gated behind DDR-005) |
| `src/core/search.ts` | `hybridSearch`/`hybridSearchMemories` — FTS5 + sqlite-vec retrieval fused via `rrf.ts`; backs the `nexus_search` MCP tool |
| `src/core/rrf.ts` | Reciprocal Rank Fusion helper — merges ranked FTS5 and vector result lists (k=60) |
| `src/capture/feedback-judge.ts` | Retrospective feedback judge — feeds `governByHelpRate` demotion/reinforcement signal (DDR-006) |
| `src/capture/reflector.ts` | Background capture pipeline — reads new transcript lines, calls Haiku, dedup-merges memories |
| `src/capture/origin.ts` | Origin classifier — decides whether a session may capture at all. Scheduled-task denylist, command/skill denylist (matched on the segment after the last `:`, so plugin-namespaced names hit), noise-cwd exclusion (OS home dir and drive roots), and `NEXUS_NO_CAPTURE`. Fails OPEN on an unreadable transcript. Gate is applied inside `reflect()` so both the hook runner and the web endpoint inherit it (ADR-20260802200851-8e). |
| `src/capture/extract.ts` | Haiku-based memory extraction from transcript windows |
| `src/capture/export.ts` | Exports memories as markdown mirror files; prunes stale project export buckets with no live memories |
| `src/capture/project-migrate.ts` | Merges project buckets fragmented by pre-fix slug bugs or subdirectory-per-project sessions onto their git-root-resolved canonical slug; dedupes via consolidateMemories, re-exports (ADR-013) |
| `src/capture/prompt-runner.ts` | UserPromptSubmit hook — embeds prompt, injects relevance-floored recall (top 3-5, per-session dedup) |
| `src/capture/secrets.ts` | Secret detection and in-place redaction — pure, dependency-free |
| `src/capture/secrets.fixtures.ts` | Shared positive/negative corpus for `secrets.test.ts` and `reflector.test.ts` |
| `extraction_models.yaml` | Runtime config: embedding model, extraction model, recall budget, capture thresholds |
| `package.json` | Project manifest, scripts, dependencies |
| `scripts/review-distill.mjs` | Read-only reviewer for `nexus_distill` output — shows each merged memory next to the originals it superseded, via `memories.superseded_by`. Run with `npm run review-distill -- <project-slug> [limit]`. |
| `scripts/distill-sweep.mjs` | Drives `distillMemories` chunk-by-chunk until `eligibleRemaining` hits 0, importing the current `dist/` build (the long-lived MCP server pins whatever build it started with). Aborts on a stalled cursor or on `clusters > 0 && created == 0` (silent extraction-backend failure). `--merge-model` routes merges at a local Ollama model. `--min-free-vram`/`--vram-poll` park each chunk until the GPU has enough free VRAM (via `nvidia-smi`; no-op if unavailable). `--max-runtime-min` stops at the next chunk boundary once a wall-clock deadline passes, so an unattended run hands the machine back on schedule. `node scripts/distill-sweep.mjs [--limit N] [--project SLUG] [--merge-model M] [--min-free-vram N] [--max-runtime-min N] [--dry-run]`. |
| `scripts/nightly-distill.ps1` | Task Scheduler wrapper around `distill-sweep.mjs` for the unattended overnight run (GPU-gated, 6h budget, gemma3:12b merge model); logs to `.flow/distill-logs/`, pruned at 30 days. Runs via `pwsh -NonInteractive -NoProfile -File` (not an inline `-Command`) — see NOTE for why. Always exits 0. |
| `scripts/pre-sweep-snapshot.mjs` | Safety pre-check to run immediately before a sweep: `VACUUM INTO`s a WAL-consistent snapshot of `nexus.db` and records a `--since` rollback anchor (from SQLite's own clock, not the system clock) to `.flow/distill-sweep-anchor.json`. Pairs with `scripts/rollback-distill.mjs`. `node scripts/pre-sweep-snapshot.mjs`. |
| `scripts/check-merge-model.mjs` | Pre-sweep gate for a candidate merge model — runs the real `mergePrompt()` over clusters with known identifiers and fails any model that drops one. Includes identifier-dense cases mirroring observed failures (ADR-018). `node scripts/check-merge-model.mjs <ollama-model\|configured>`. |
| `scripts/validate-extraction.mjs` | Permanent eval-gate harness (same pattern as `check-merge-model.mjs`) — runs the real `extractMemories()` against two fixture cases and asserts known facts survive: preference-crowding (NOTE-20260730134513-3b) and phase-section-cue (FEAT-20260730150641-ad). Not part of `npm test` (makes real extraction-model calls); run manually before landing any `extract.ts` SYSTEM_PROMPT change. Replaces 13 one-off `scratch-*.ts`/`.json` files formerly at the repo root. `npm run build && node scripts/validate-extraction.mjs`. |
| `scripts/audit-merges.mjs` | Post-sweep verification on two independent signals: **identifier loss** (code-like tokens in the superseded originals missing from the merge) and **coverage** (cosine of the merge against each folded source, read straight from `memories_vec` — a low minimum means a source was ignored, which identifier-matching cannot detect for prose-only sources). `--strict`, `--all`, `--db <snapshot>` for before/after, `--out <json>` writes flagged merges plus their originals' full text for later agent review. Read-only, safe during a live sweep. |
| `scripts/purge-origin.mjs` | Retroactively deletes memories captured from excluded-origin sessions, reusing `classifyOrigin` so live and historical rules cannot drift. Resolves `source_session_id` → transcript under `~/.claude/projects`. Fails CLOSED: a memory whose transcript is gone is reported and KEPT. Dry-run by default; `VACUUM INTO` snapshot before `--apply`. |
| `scripts/rollback-distill.mjs` | Undoes a distill sweep: restores folded originals (`superseded_by` → NULL), deletes the merges, clears `distilled_at`. Identifies merges by their `'refines'` links and aborts if any candidate has a `source_session_id` (i.e. is not distill output). Dry-run by default; `VACUUM INTO` snapshot before `--apply`. |

## Key folders

| Folder | Role |
|--------|------|
| `src/capture/` | All capture-side modules: transcript reading, extraction, reflector, export, prompt-runner |
| `src/core/` | Shared core: database, embeddings, recall, decay, consolidation, config, types, links |
| `src/mcp/` | MCP server and tool implementations |
| `src/web/` | Express REST API and route handlers |
| `src/frontend/` | Svelte 5 SPA dashboard — Dashboard, Memories, Review, Sessions, Search, Plans, Agents, Skills views |
| `src/cli/` | CLI commands: index, search, context, list, health, stats, sessions, watch, backfill, prune-narration, migrate-projects |
| `src/indexer/` | Knowledge file scanner and parser — indexes agents, skills, plans, notes from ~/.claude/ |
| `hooks/` | Claude Code hook scripts and hooks.json manifest |
| `dist/` | Compiled JS output from tsc — what hooks and MCP server actually run |
| `scripts/` | Standalone ops/dev scripts (startup registration, VCC backfill, distill review) run directly via node/python, outside the CLI/MCP surface |
