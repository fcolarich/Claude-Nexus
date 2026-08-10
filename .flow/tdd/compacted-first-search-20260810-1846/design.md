# Design: nexus_search_session — compacted-first session content search

Previously-deferred feature (FEAT-20260808153312-b0), now built on top of the VCC follow-ups (transcript_path exposure + parallel-file auto-compact) merged in the prior TDD run.

## Problem

`nexus_search` only searches extracted memories, not raw session content. If extraction missed something, or you need to find where a specific thing was actually discussed, there's no way to search a session's transcript directly. The prior run made `sessions.vcc_shrunk_path` available (a periodic compacted copy of large transcripts) but nothing consumes it yet.

## Goals

- A new MCP tool, `nexus_search_session(session_id, query)`, searches a session's content and returns matching snippets.
- Prefer the compacted (`vcc_shrunk_path`) copy when available — cheaper to read/search — falling back to the full transcript only when needed.
- Track how much the tool is actually used, surfaced through the existing `nexus_stats` tool (no new analytics tool).

## Non-goals

- No persistent FTS5 index over session content (grep-scale on-demand search is enough for now; the usage log itself will tell us if that changes).
- No regex support (avoid ReDoS from user-supplied patterns) — plain case-insensitive substring only.
- No new dedicated usage-tracking tool — extend `nexus_stats`.

## Constraints

- Reuse existing primitives: `readTranscriptWindow(jsonlPath, 0).text` (already condenses + truncates the full transcript) for the fallback path; no new JSONL rendering code.
- The `.vcc-shrunk.jsonl` file is confirmed (via `vcc_compact/cli.py`) to hold rendered plain text, not JSONL — read and search it directly, no parsing.
- Fail-open: usage-log write failure must never block returning search results, matching this repo's convention (e.g. `reflector.ts`'s vcc trigger).
- Files in scope: `src/core/text-search.ts` (new), `src/core/search.ts` (+`getSessionById`, +`getStats` extension), `src/core/database.ts` (+migration v13), `src/mcp/server.ts` (+`nexus_search_session` tool, +`nexus_stats` extension) — plus co-located `*.test.ts` for each.

## Proposed Approach

`nexus_search_session(session_id, query)`:

1. `getSessionById(db, session_id)` — new helper in `core/search.ts`, mirrors `listSessions`' query style.
2. If `session.vcc_shrunk_path` is set and the file exists on disk: read as plain text, search via `grepText`.
3. If that yields zero matches (or there's no shrunk file at all): fall back to `readTranscriptWindow(session.jsonl_path, 0).text`, search that instead.
4. Return matches labeled by source (`compacted summary` vs `full transcript`), capped at ~20 matches with a short context snippet each.
5. No matches anywhere → say so explicitly, naming which sources were checked. Session not found, or transcript file missing on disk → clear error text, never throw.
6. Log one row to `session_search_log` per call (session_id, query, source used, match_count) in its own try/catch — never blocks the response.

New pure helper `grepText(text, query, opts?)` in `src/core/text-search.ts`: case-insensitive plain-substring match, returns snippets with surrounding context, capped match count.

Migration v13 (`session-search-log`):

```sql
CREATE TABLE session_search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  query       TEXT NOT NULL,
  source      TEXT NOT NULL CHECK(source IN ('compacted','full','none')),
  match_count INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`getStats()` (core/search.ts) extended with `totalSessionSearches` and a `sessionSearchesBySource` breakdown; `nexus_stats` handler renders one more line: `**Session searches:** N total (compacted: X, full: Y, none: Z)`.

**Alternatives considered:**

- Persistent FTS5 index over session content — rejected for now; on-demand grep is near-zero infrastructure and directly reuses the compaction work just shipped. The usage log is the trigger to reconsider this later.
- Regex search — rejected, ReDoS risk from arbitrary user-supplied patterns.
- New dedicated usage-tracking MCP tool — rejected, `nexus_stats` already exists for exactly this purpose.

## Key Questions for the architect

- Exact snippet/context-window size and match cap for `grepText` — propose ~1-2 lines of context, cap 20 matches; architect to confirm this doesn't blow up typical MCP response size.
- Where exactly `getSessionById` and the `session_search_log` insert should live relative to existing transaction/error-handling patterns in `search.ts` and `server.ts`.
- Confirm `getStats()`'s existing return shape/consumers aren't broken by additive fields (same class of check as the prior run's `CompactResult` extension).

## Success Criteria

- `nexus_search_session` returns matches from the compacted file when present and matching; falls back to full transcript when the compacted file is absent, missing on disk, or yields zero matches.
- Session-not-found and transcript-file-missing cases return clear text, never throw.
- One `session_search_log` row is written per call, tagged with the correct `source` (`compacted`/`full`/`none`), even when the search itself finds nothing.
- `nexus_stats` output includes the new session-search counts, correctly broken down by source.
- `npm test` passes with zero regressions to the existing suite.
