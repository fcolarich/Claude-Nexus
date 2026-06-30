---
id: ADR-009
title: Prompt-driven semantic recall via UserPromptSubmit
type: adr
date: 2026-06-30
status: accepted
supersedes: null
tags: ["recall", "hooks", "embeddings", "UserPromptSubmit"]
---

**Decision:** Replace the SessionStart bulk-dump recall with a UserPromptSubmit hook (dist/capture/prompt-runner.js) that embeds each user prompt, vector-searches approved memories with a cosine relevance floor (recall.min_similarity, default 0.55) and a recall.min_words gate (default 4), dedups against memories already injected this session via ~/.claude/memories/.recall-state/<session_id>.json, and injects the top 3-5 matches as additionalContext. Degrades to FTS5 when embeddings are unavailable. src/capture/load-runner.ts is deleted. The bulk recallMemories function is retained and still used by the nexus_recall MCP tool and the web API for explicit query-or-bulk recall.

**Alternatives:** Keep the SessionStart bulk dump (rejected: injects memories ranked by decay only, with zero relevance to the actual work, and nothing ever recalled memories semantically in-session). Gate recall on keyword matching of the prompt (rejected in favor of a content-based cosine relevance floor, which generalizes across phrasing).

**Reason:** The old SessionStart dump ranked memories by decay-confidence with no relevance to the work at hand, and no mechanism recalled memories semantically mid-session. Embedding the prompt and applying a similarity floor surfaces only memories relevant to what the user is actually doing, while per-session dedup avoids re-injecting the same memory on every prompt.
