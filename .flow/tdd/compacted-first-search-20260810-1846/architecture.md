# Architecture: nexus_search_session — compacted-first session content search

## Components

### text-search (`src/core/text-search.ts`, new)

**Responsibility:** Pure, dependency-free plain-substring matcher that turns a blob of text plus a query into a capped list of line-anchored context snippets.

**Interface:**

```ts
// src/core/text-search.ts — no db, no fs, no imports from other core modules

export interface GrepOptions {
    maxMatches?: number;       // default 20
    contextLines?: number;     // default 1 (one line before + one after)
    maxSnippetChars?: number;  // default 400 (per snippet, after context assembly)
}

export interface GrepMatch {
    line: number;         // 1-based line number of the matching line
    occurrences: number;  // hits on that line (>=1)
    snippet: string;      // context lines joined by "\n", window-trimmed
}

export interface GrepResult {
    matches: GrepMatch[];
    totalMatches: number;  // total matching LINES found before the cap
    truncated: boolean;    // totalMatches > matches.length
}

export function grepText(text: string, query: string, opts?: GrepOptions): GrepResult;
```

### session lookup + search service (`src/core/search.ts`, extended)

**Responsibility:** Owns all SQLite access for this feature (session row lookup, usage-log write, stats aggregation) and orchestrates the compacted-first / full-transcript fallback into a structured result.

**Interface:**

```ts
// src/core/search.ts — additions only, existing exports untouched

export interface SessionRow {
    session_id: string;
    project_slug: string | null;
    jsonl_path: string | null;
    vcc_shrunk_path: string | null;
    started_at: string | null;
    last_seen_at: string | null;
    // ...remaining sessions columns, same shape listSessions() already returns
}

export type SessionSearchSource = 'compacted' | 'full' | 'none';

export interface SessionSearchResult {
    status: 'ok' | 'no-matches' | 'session-not-found' | 'no-content';
    sessionId: string;
    query: string;
    source: SessionSearchSource;
    sourcesChecked: string[];   // e.g. ['compacted summary', 'full transcript']
    matches: GrepMatch[];
    totalMatches: number;
    truncated: boolean;
    detail?: string;            // why status is not 'ok' (missing file, no paths, etc.)
}

export function getSessionById(db: Database, sessionId: string): SessionRow | undefined;

export function logSessionSearch(
    db: Database,
    entry: { sessionId: string; query: string; source: SessionSearchSource; matchCount: number }
): void;

export function searchSession(
    db: Database,
    sessionId: string,
    query: string,
    opts?: GrepOptions
): SessionSearchResult;   // never throws; logs to session_search_log internally, fail-open

// existing getStats() return type gains two ADDITIVE fields
export interface Stats {
    // ...all existing fields unchanged...
    totalSessionSearches: number;
    sessionSearchesBySource: { compacted: number; full: number; none: number };
}
```

### migration v13 (`src/core/database.ts`, extended)

**Responsibility:** Creates the `session_search_log` table and its lookup index, and bumps `schema_version` to 13 following the existing sequential-migration pattern.

**Interface:**

```ts
// src/core/database.ts — inside the existing migration ladder
// case 12: // -> 13  "session-search-log"
//   db.exec(CREATE TABLE session_search_log ...; CREATE INDEX ...);
//   setSchemaVersion(db, 13);
```

### MCP tool layer (`src/mcp/server.ts`, extended)

**Responsibility:** Registers `nexus_search_session`, validates/normalises its arguments, and renders both the search result and the extended stats block as text — no search or SQL logic of its own.

**Interface:**

```ts
// tool: nexus_search_session
// inputSchema: {
//   session_id:  string (required),
//   query:       string (required, non-empty after trim),
//   max_matches: number (optional, 1..50, default 20)
// }
// handler: const r = searchSession(db, session_id, query, { maxMatches });
//          return { content: [{ type: 'text', text: renderSessionSearch(r) }] };

function renderSessionSearch(r: SessionSearchResult): string;  // module-local helper

// nexus_stats handler renders one additional line:
// **Session searches:** N total (compacted: X, full: Y, none: Z)
```

---

## Data Flow

### Operation: `nexus_search_session` finds matches in the compacted copy

1. `server.ts` handler receives `{ session_id, query, max_matches? }`, trims `query`, rejects empty with clear text (no throw).
2. Handler calls `searchSession(db, session_id, query, { maxMatches })` in `core/search.ts`.
3. `searchSession` calls `getSessionById(db, session_id)` and gets a `SessionRow`.
4. `vcc_shrunk_path` is set and `fs.existsSync` is true, so it reads `fs.readFileSync(path, 'utf8')` (plain text, no JSONL parsing) and calls `grepText(text, query, opts)`.
5. `grepText` returns at least one match, so the result is built with `source: 'compacted'` and `sourcesChecked: ['compacted summary']`.
6. `searchSession` calls `logSessionSearch(db, { source: 'compacted', matchCount, ... })` inside its own try/catch; a write failure is swallowed (fail-open).
7. `searchSession` returns the `SessionSearchResult`; the handler renders `**Source:** compacted summary` plus one bullet per snippet and returns the text.

### Operation: fallback to the full transcript

1. Steps 1-3 above run unchanged.
2. `vcc_shrunk_path` is null, OR the file does not exist on disk, OR `grepText` on it returned zero matches.
3. `searchSession` calls `readTranscriptWindow(session.jsonl_path, 0).text` (existing primitive, already condenses and truncates) inside a try/catch.
4. `grepText(fullText, query, opts)` returns matches, so `source` becomes `'full'` and `sourcesChecked` lists both `'compacted summary'` (only when it was actually attempted) and `'full transcript'`.
5. `logSessionSearch` records `source: 'full'` with the match count; the handler renders the result.

### Operation: zero matches anywhere

1. Both sources yield zero matches, or the only readable source yielded zero.
2. `searchSession` returns `status: 'no-matches'`, `source: 'none'`, `matches: []`, and a `sourcesChecked` naming every source actually read.
3. `logSessionSearch` writes a row with `source: 'none'` and `match_count: 0`.
4. Handler renders `No matches for "<query>" in session <id>. Searched: compacted summary, full transcript.`

### Operation: session not found or no readable content

1. `getSessionById` returns `undefined`, so `status` is `'session-not-found'`, `source` is `'none'`, `detail` is set, and `logSessionSearch` still fires.
2. Session exists but `jsonl_path` is null, the file is missing, or `readTranscriptWindow` throws — the throw is caught and `status` becomes `'no-content'` with `detail` naming the missing path.
3. Handler renders a single clear line in both cases; `searchSession` never propagates an exception to the MCP layer.

### Operation: `nexus_stats` reports usage

1. Handler calls the existing `getStats(db)`.
2. `getStats` runs its existing queries, then two additive reads: `SELECT COUNT(*) FROM session_search_log` and `SELECT source, COUNT(*) FROM session_search_log GROUP BY source`.
3. Missing sources are zero-filled so `sessionSearchesBySource` always carries all three keys.
4. Handler appends `**Session searches:** N total (compacted: X, full: Y, none: Z)` to the existing rendered block.

---

## Storage

### session_search_log (migration v13, `session-search-log`)

```sql
CREATE TABLE session_search_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,                                   -- not a FK; sessions rows may be pruned
    query       TEXT NOT NULL,                                   -- raw trimmed user query
    source      TEXT NOT NULL CHECK(source IN ('compacted','full','none')),
    match_count INTEGER NOT NULL,                                -- 0 when source = 'none'
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))          -- UTC, matches repo convention
);

CREATE INDEX IF NOT EXISTS idx_session_search_log_session
    ON session_search_log(session_id, created_at DESC);
```

Append-only. There is no UPDATE path, so no `ON CONFLICT DO UPDATE` clause is required or written.

### Stats shape (in-memory, returned by `getStats`)

```ts
{
    /* ...all pre-existing fields, byte-identical... */
    totalSessionSearches: number,                 // COUNT(*) of session_search_log
    sessionSearchesBySource: {
        compacted: number,                        // zero-filled
        full: number,
        none: number
    }
}
```

---

## Decisions

### Snippet sizing and match cap

**Decision:** Line-anchored snippets — the matching line plus `contextLines: 1` on each side — with a hard `maxSnippetChars: 400` trim centred on the first hit in the line, and `maxMatches: 20` (tool-overridable 1-50). Multiple hits on the same line collapse into one snippet with an `occurrences` count.

**Alternatives:** Pure character-window snippets (plus/minus 160 chars, ignoring line boundaries); no per-snippet cap; cap 50 by default.

**Rationale:** Worst case is 20 x 400 which is about 8 KB plus headers — under 10 KB, comfortably inside a normal MCP text response and far below the memory-recall payloads this server already returns. Line boundaries make rendered transcript text readable, but rendered JSONL can contain single lines tens of KB long, so the per-snippet char trim is what actually bounds the response; without it a line-based scheme is unbounded. Collapsing per-line duplicates stops one repetitive line from consuming the whole cap.

### Orchestration lives in `search.ts`, not the tool handler

**Decision:** `searchSession()` (lookup, compacted, fallback, log) is a service function in `src/core/search.ts`. `server.ts` only parses args, calls it, and formats text via a module-local `renderSessionSearch`.

**Alternatives:** Put the fallback ladder inline in the MCP handler as the design's step list literally reads; put it in a third new module.

**Rationale:** Repo convention is thin controllers with logic in services. Keeping it in `search.ts` also makes the whole ladder unit-testable against an in-memory DB with no MCP transport, and leaves the door open for the CLI or REST API to call the same function later. `text-search.ts` stays pure (no fs, no db) so `grepText` is testable in isolation.

### `getSessionById` placement and query style

**Decision:** New export in `src/core/search.ts`, immediately adjacent to `listSessions`, using the same `db.prepare(...).get(sessionId)` style and returning `SessionRow | undefined` — no throw on miss, no transaction, `SELECT *` narrowed by the shared row type.

**Alternatives:** Add it to `core/database.ts`; have it throw a `SessionNotFoundError`.

**Rationale:** `database.ts` owns schema and migrations, not query helpers, and `search.ts` already owns session reads. Returning `undefined` keeps the fail-open, never-throw contract at the lowest level instead of forcing every caller into a try/catch.

### Usage-log write is fail-open and outside any transaction

**Decision:** `logSessionSearch` is a single `INSERT` on its own implicit better-sqlite3 transaction, called from `searchSession` inside a dedicated try/catch that swallows the error (optionally `console.error` to stderr, never stdout). No `db.transaction()` wrapper, and it is never in the same unit of work as the read path.

**Alternatives:** Wrap lookup, search, and log in `db.transaction()`; let the insert error bubble and be caught by the MCP handler's outer try/catch.

**Rationale:** Matches the repo's fail-open convention (for example `reflector.ts`'s vcc trigger). A transaction buys nothing for a single append-only insert with no read-modify-write, and wrapping the read path would let a locked DB turn a successful search into a failed tool call. stdout is the MCP stdio transport, so logging there would corrupt the protocol stream.

### Logging happens on every terminal path, including errors

**Decision:** `logSessionSearch` is called from a single point at the end of `searchSession` for all four statuses, with `source: 'none'` and `match_count: 0` for `no-matches`, `session-not-found`, and `no-content`.

**Alternatives:** Log only on successful searches; add a fourth `source` value for error cases.

**Rationale:** The log exists to answer "is this tool worth a real FTS5 index?" — failed and empty lookups are exactly the signal that says the compacted-first strategy is not paying off. A fourth enum value would require changing the design's agreed `CHECK` constraint for no analytic gain; distinctions that matter later can be recovered from `match_count` plus additive columns.

### `getStats()` extension is purely additive

**Decision:** Add `totalSessionSearches` and `sessionSearchesBySource` as new keys; do not rename, retype, or reorder any existing key. Known consumers — the `nexus_stats` MCP handler, the REST `/api/stats` route consumed by the Svelte dashboard, and the CLI `stats` command — all read named fields or spread the object into JSON, so extra keys are inert. A test asserts every pre-existing key is still present with its original type.

**Alternatives:** Return a nested `sessionSearch: {...}` sub-object; expose the counts from a separate `getSessionSearchStats()` the handler calls alongside `getStats`.

**Rationale:** Same class of check as the prior run's `CompactResult` extension: structural typing means additive fields cannot break existing TS callers, and JSON consumers that pick named fields ignore the rest. The dashboard renders a fixed field list, so no UI change is forced. A separate function would mean two call sites and two round trips for one rendered line.

### Compacted file is read as plain text; fallback reuses `readTranscriptWindow`

**Decision:** `vcc_shrunk_path` is read with `fs.readFileSync(path, 'utf8')` and searched directly, with no JSONL parsing. The fallback uses `readTranscriptWindow(jsonl_path, 0).text` unchanged.

**Alternatives:** Parse the shrunk file as JSONL; write a new transcript renderer tuned for search.

**Rationale:** `vcc_compact/cli.py` writes rendered plain text, so parsing would fail outright. `readTranscriptWindow` already condenses and truncates, which both bounds memory on huge transcripts and guarantees the searched text matches what the rest of the system considers the transcript's content — a second renderer would drift.

### Compacted-with-zero-matches still falls through to the full transcript

**Decision:** Zero matches in the compacted copy triggers the full-transcript read, and `sourcesChecked` records both. Only the source that actually produced the returned matches sets `source`.

**Alternatives:** Trust the compacted copy as authoritative and return "no matches" immediately.

**Rationale:** Compaction is lossy by construction, so absence of a hit there is not evidence of absence. The cost is one extra read on the miss path only. Attributing `source` to the winning read keeps the usage log's compacted-vs-full ratio meaningful as a measure of how often compaction is sufficient.

---

## Open Questions

<!-- These must be resolved before /plan runs. Planner will fail if ambiguous. -->

- None blocking. All three "Key Questions for the architect" are answered above with committed defaults: snippet sizing (`contextLines: 1`, `maxSnippetChars: 400`, `maxMatches: 20`, about 8 KB worst-case response), placement (`getSessionById`, `logSessionSearch`, and `searchSession` all in `src/core/search.ts`; the insert is single-statement, untransacted, fail-open; `server.ts` stays render-only), and `getStats()` additivity (two new keys, existing keys unchanged, regression test pins the old shape).
