# Implementation Spec: nexus_search_session — compacted-first session content search

## Implementation Approach

Build bottom-up, leaf modules first: `text-search.ts` and the database migration have zero dependencies on each other or on this feature's other pieces, so both start immediately. Data-access helpers in `search.ts` come next (need the migration's table). The orchestrator (`searchSession`) sits on top of both `text-search.ts` and the data-access helpers — it's the one piece requiring real judgment (compacted-first-with-fallback-on-zero-matches, fail-open logging on every terminal path, never-throw contract) and shouldn't start until its building blocks are proven. `getStats()` extension only needs the migration, not the orchestrator, but is sequenced after it purely to avoid two tasks editing `search.ts` concurrently. `server.ts` is last — the public MCP surface, wiring already-tested service functions into tool registrations with no logic of its own (thin controller, per repo convention).

Non-goals to actively avoid during implementation: no persistent FTS5 index (on-demand grep is the whole point), no regex support (ReDoS risk — plain case-insensitive substring only), no new MCP tool for usage stats (extend `nexus_stats`, don't add one).

Follow existing repo conventions throughout:

- `db.prepare(sql).get()/.all()`, no ORM, no query builder.
- Tabs for indentation.
- Thin controllers (`server.ts`), logic in services (`search.ts`).
- Fail-open error handling matches `reflector.ts`'s vcc-trigger pattern: try/catch that swallows and never blocks the primary response; log to stderr if at all, never stdout (stdout is the MCP stdio transport).
- Additive-only changes to any existing exported shape — `getStats()`'s current fields stay byte-identical.

## Build Order and Dependencies

1. **text-search.ts** (`grepText`) — no deps. Pure string-in/struct-out, fully testable standalone.
2. **database.ts** (migration v13) — no deps. Must land before anything touches `session_search_log`.
3. **search.ts data-access** (`getSessionById`, `logSessionSearch`) — depends on (2) for `logSessionSearch`'s target table. Bundled together: both are small single-purpose accessors added to the same file for the same feature.
4. **search.ts orchestrator** (`searchSession`) — depends on (1) and (3). Ties together `grepText`, the data-access helpers, `fs`, and the existing `readTranscriptWindow` primitive.
5. **search.ts stats extension** (`getStats()`) — logically only needs (2); sequenced after (4) to keep all `search.ts` edits linear and avoid concurrent-edit conflicts.
6. **server.ts tool** (`nexus_search_session`) — depends on (4). Public MCP surface; thin wiring only.
7. **server.ts stats line** (`nexus_stats` extension) — depends on (5) for data and (6) to keep `server.ts` edits linear.

Parallel-safe pairs (different files, no shared dependency): (1) with (2) at the start; (5) with (6) once (4) lands.

## Test Strategy

| Component | Strategy | Rationale |
| --- | --- | --- |
| text-search.ts | Unit only | Pure function, no I/O, no db — nothing to integrate with |
| database.ts migration v13 | Unit/integration hybrid, real temp db | Migration correctness can only be verified by actually running it against sqlite — schema_version, table shape, CHECK constraint, and index all need a real run, not a mock |
| search.ts getSessionById / logSessionSearch | Unit, real temp db (migrated) | Repo convention tests db-touching code against a real temp sqlite db, not a mocked better-sqlite3 |
| search.ts searchSession | Unit, real temp db + real temp fixture files, no MCP transport | Highest-value surface in the feature — the fallback ladder and never-throw contract are exactly what the success criteria hinge on; needs real files on disk to honestly exercise "file missing" and "file present but zero matches" branches |
| search.ts getStats() extension | Unit, real temp db seeded across all 3 sources, plus one explicit regression test | Regression test pins every pre-existing key/type per architecture's committed additive-only decision — this is the check that prevents an accidental breaking change from landing |
| server.ts nexus_search_session | Unit, call registered handler directly | Matches existing tool-test convention (nexus_sessions, nexus_stats) — no live stdio transport test exists in this repo, don't introduce one |
| server.ts nexus_stats extension | Unit, extend existing test | One more asserted line; existing coverage pattern already fits |

No component gets "none" — the design's explicit success criteria (never-throw, correct source tagging, additive stats, zero regressions) are all behaviors only tests can pin down, and `npm test` passing with zero regressions is itself a stated success criterion.

## Edge Cases and Error Handling

### text-search.ts (`grepText`)

- Empty query or empty text → zero matches, not a crash (defensive even though the tool layer also rejects empty query before calling in).
- Match at the very first/last line → context window must not read out of bounds.
- Multiple hits on one line → collapse into a single `GrepMatch` with `occurrences` count, not N separate matches.
- A single line longer than `maxSnippetChars` (rendered JSONL can have very long lines) → trim centered on the first hit; this char-trim is what actually bounds response size, not the line-based windowing.
- `totalMatches` exceeds `maxMatches` cap → `truncated: true`, `matches.length` capped, `totalMatches` still reflects the true count.
- Case-insensitivity in both query and text.

### database.ts (migration v13)

- `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` → safe to run against an already-migrated db, matches the existing new-table migration pattern.
- CHECK constraint on `source` enforced at the db level — an invalid value fails the INSERT itself (this is what `logSessionSearch` relies on being caught by its caller, not by the table).
- No existing table touched — purely additive.

### search.ts (`getSessionById`, `logSessionSearch`)

- `getSessionById`: unknown `session_id` → `undefined`, not a throw — this is an expected, common case the caller branches on.
- `logSessionSearch`: a plain, unguarded single INSERT — per architecture's decision, the fail-open try/catch lives at the call site in `searchSession`, not inside this function. Test should confirm it *does* throw on a constraint violation (e.g., bad `source` value), proving it's a faithful thin wrapper with no hidden swallowing.

### search.ts (`searchSession`)

Most of the feature's edge-case surface concentrates here:

- Session not found → `status: 'session-not-found'`, `source: 'none'`, `detail` set, still logs a row (log fires on every terminal path, per architecture).
- `vcc_shrunk_path` is `null` → skip straight to the full-transcript path; `sourcesChecked` only lists `'full transcript'`.
- `vcc_shrunk_path` set but file missing on disk (`fs.existsSync` false) → not an error, falls through to full transcript.
- Compacted file reads fine but `grepText` returns zero matches → still falls through to full transcript (the architecture's central compacted-first-with-fallback-on-zero-matches decision) — `sourcesChecked` lists both.
- `jsonl_path` null, or `readTranscriptWindow` returns empty text (it returns `{text: ''}` rather than throwing on a missing file) → treat as the no-content signal; still wrap in try/catch for genuinely unexpected errors (permissions, encoding), consistent with fail-open framing.
- Both sources checked, zero matches in both → `status: 'no-matches'`, `source: 'none'`.
- `logSessionSearch` is called from exactly one point at the end of the function covering every branch above — not scattered per-branch calls — so "logs on every terminal path" is structurally guaranteed, not something each branch has to remember. That single call site is wrapped in its own try/catch that swallows write failures.
- The function as a whole must never let an exception escape — an outer boundary around the full body producing a safe fallback result on any unexpected internal error.

### search.ts (`getStats()` extension)

- Zero rows in `session_search_log` (fresh db, feature unused) → all three source keys present and `0` — zero-fill explicitly before merging `GROUP BY` results, since `GROUP BY` only returns rows for sources that have ≥1 entry.

### server.ts (`nexus_search_session`)

- Empty/whitespace-only query after trim → reject with clear text, do not call `searchSession`.
- `max_matches` outside 1-50 → constrained by the zod schema itself.
- Handler doesn't throw even in principle, as defense in depth on top of `searchSession`'s own never-throw contract.

### server.ts (`nexus_stats` extension)

- No special-case handling needed — `LATEST_SCHEMA_VERSION` derives from the migrations array and migrations always run in order at startup, so `session_search_log` existing is guaranteed by the time `getStats()` queries it.
