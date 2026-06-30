# Prompt-Driven Semantic Recall Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `dispatch-agents` skill to implement this plan task-by-task.

**Goal:** Replace the unranked SessionStart memory dump with a `UserPromptSubmit` hook that embeds each user prompt, vector-searches memories, and injects only the few that clear a relevance floor.

**Architecture:** A new `UserPromptSubmit` hook (`prompt-runner.ts`) reads the prompt from stdin, gates on word count, calls a new `recallByQuery` function (vector search + cosine relevance floor + per-session dedup), and injects the top 3-5 matches as `additionalContext`. The old `recallMemories` bulk path stays (still used by the `nexus_recall` MCP tool and the web API); only `load-runner.ts` and the `SessionStart` hook wiring are removed. Embedding-down degrades to FTS5.

**Tech Stack:** TypeScript (ESM, Node 22+), better-sqlite3 + sqlite-vec, Ollama mxbai-embed-large, Vitest. Hook manifest lives in the local-marketplace plugin source.

---

### Task 0: Branch

**Files:** none (git only)

**Step 1: Create a working branch**

The repo has pre-existing uncommitted changes to `src/core/embeddings.ts` and `dist/`. Do NOT touch or revert them. Create a branch off the current state:

```bash
cd C:\Fran\claude-nexus
git checkout -b feat/prompt-driven-recall
```

**Step 2: Verify**

Run: `git branch --show-current`
Expected: `feat/prompt-driven-recall`

---

### Task 1: Add recall gating config

**Files:**
- Modify: `src/core/config.ts:36-40` (NexusConfig.recall interface)
- Modify: `src/core/config.ts:72-76` (DEFAULTS.recall)
- Modify: `extraction_models.yaml:28-30` (recall section)

**Step 1: Extend the `recall` config type**

In `src/core/config.ts`, replace the `recall` block of the `NexusConfig` interface (currently lines 36-40):

```typescript
  recall: {
    max_tokens: number;
    min_confidence: number;
    max_title_items: number;
    min_words: number;        // prompts shorter than this skip prompt-driven recall
    min_similarity: number;   // cosine floor (0-1) a memory must clear to be injected
  };
```

**Step 2: Extend DEFAULTS**

In the same file, replace the `recall` block of `DEFAULTS` (currently lines 72-76):

```typescript
  recall: {
    max_tokens: 2000,
    min_confidence: 0.35,
    max_title_items: 25,
    min_words: 4,
    min_similarity: 0.55,
  },
```

**Step 3: Document in YAML**

In `extraction_models.yaml`, replace the `recall:` section (currently lines 25-30) with:

```yaml
# Recall — memory injection.
# Bulk recall (nexus_recall MCP tool, web API) is ranked by the decay model
# (src/core/decay.ts), keyed on each memory's decay_class.
# Prompt-driven recall (UserPromptSubmit hook) is ranked by vector similarity.
recall:
  max_tokens: 2000              # hard cap on bulk-recall injected context
  min_confidence: 0.35          # effective (decayed) confidence below this is not bulk-injected
  min_words: 4                  # user prompts shorter than this skip prompt-driven recall
  min_similarity: 0.55          # cosine floor (0-1) a memory must clear to be prompt-injected
```

**Step 4: Verify**

Run: `cd C:\Fran\claude-nexus && npx tsc --noEmit`
Expected: no errors.

**Step 5: Commit**

```bash
git add src/core/config.ts extraction_models.yaml
git commit -m "feat(recall): add min_words and min_similarity gating config"
```

---

### Task 2: Add `recallByQuery` to recall.ts

`recallByQuery` ranks by vector cosine similarity with a relevance floor, dual-bank scope (project + global/shared), and an exclude list for per-session dedup. Falls back to FTS5 only when no embedding is available OR the corpus has no vectors at all (so the floor is never silently bypassed on an embedded corpus).

**Files:**
- Modify: `src/core/recall.ts` (add imports + new exported function)
- Test: `src/core/recall.test.ts`

**Step 1: Write the failing test**

Append to `src/core/recall.test.ts` (before the final closing of the file, after the existing `describe` block):

```typescript
import { recallByQuery } from './recall.js';

describe('recallByQuery', () => {
  // Offline/CI has no Ollama, so generateEmbedding returns null and recallByQuery
  // uses its FTS5 fallback — these assertions hold on the fallback path.
  it('returns query-matching memories, dual-bank scope', async () => {
    const db = freshDb();
    add(db, { title: 'Tabs rule', body: 'always use tabs for indentation', project: 'projA' });
    add(db, { title: 'Other proj', body: 'tabs but wrong project', project: 'projB' });
    add(db, { title: 'Global tabs', body: 'global tabs note', scope: 'global', project: null });
    const r = await recallByQuery(db, { project: 'projA', query: 'tabs' });
    const titles = r.items.map(i => i.memory.title);
    expect(titles).toContain('Tabs rule');
    expect(titles).toContain('Global tabs');
    expect(titles).not.toContain('Other proj');
    db.close();
  });

  it('excludes memories in excludeIds (session dedup)', async () => {
    const db = freshDb();
    const id = add(db, { title: 'Tabs rule', body: 'always use tabs for indentation' }).id;
    const r = await recallByQuery(db, { project: 'projA', query: 'tabs', excludeIds: [id] });
    expect(r.items.map(i => i.memory.title)).not.toContain('Tabs rule');
    db.close();
  });

  it('returns empty for a query that matches nothing', async () => {
    const db = freshDb();
    add(db, { title: 'Tabs rule', body: 'always use tabs for indentation' });
    const r = await recallByQuery(db, { project: 'projA', query: 'kubernetes networking' });
    expect(r.items).toHaveLength(0);
    expect(r.markdown).toBe('');
    db.close();
  });
});
```

Note: `add(...)` returns the inserted memory (it calls `insertMemory`). If `insertMemory`'s return shape lacks `.id`, capture the id via the title instead — inspect `src/core/memories.ts insertMemory` return type before running.

**Step 2: Run the test to confirm it fails**

Run: `cd C:\Fran\claude-nexus && npx vitest run src/core/recall.test.ts -t recallByQuery`
Expected: FAIL — `recallByQuery is not exported` / not a function.

**Step 3: Implement `recallByQuery`**

In `src/core/recall.ts`, add these imports near the top (after the existing imports, ~line 13):

```typescript
import { generateEmbedding } from './embeddings.js';
import { normalize } from './memories.js';
```

Then append this exported function at the end of the file:

```typescript
/**
 * Prompt-driven recall: rank memories by vector cosine similarity to a query,
 * keep only those above a relevance floor, exclude a caller-supplied id set
 * (per-session dedup), and return the top `limit`. Falls back to FTS5 only when
 * no embedding is available or the corpus has no vectors — never bypasses the
 * floor on an embedded corpus.
 */
export async function recallByQuery(
  db: Database.Database,
  opts: { project?: string | null; query: string; limit?: number; minSimilarity?: number; excludeIds?: string[] }
): Promise<RecallResult> {
  const empty: RecallResult = { items: [], markdown: '', tokenEstimate: 0, total: 0 };

  const memoriesExist = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='memories'`
  ).get();
  if (!memoriesExist) return empty;

  const cfg = getNexusConfig().recall;
  const limit = opts.limit ?? 5;
  const minSimilarity = opts.minSimilarity ?? cfg.min_similarity;
  const project = opts.project ?? '';
  const exclude = new Set(opts.excludeIds ?? []);
  const scopeClause = `(m.scope IN ('global','shared') OR (m.scope='project' AND m.project = @project))`;

  const scored: { m: Memory; score: number }[] = [];
  let vecEligible = 0; // in-scope approved candidates the vector index produced (pre-floor)

  const queryVec = await generateEmbedding(opts.query);
  const vecTable = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='memories_vec'`
  ).get();

  if (queryVec && vecTable) {
    const norm = normalize(queryVec);
    let rows: { rowid: number; distance: number }[] = [];
    try {
      rows = db.prepare(`
        SELECT rowid, distance FROM memories_vec
        WHERE embedding MATCH json(@v)
        ORDER BY distance
        LIMIT @k
      `).all({ v: JSON.stringify(Array.from(norm)), k: Math.max(limit * 6, 30) }) as { rowid: number; distance: number }[];
    } catch { rows = []; }

    for (const r of rows) {
      const row = db.prepare(`
        SELECT m.* FROM memories m
        WHERE m.rowid = @rowid
          AND m.review_status = 'approved' AND m.superseded_by IS NULL
          AND ${scopeClause}
      `).get({ rowid: r.rowid, project }) as Record<string, unknown> | undefined;
      if (!row) continue;
      const m = rowToMemory(row);
      vecEligible++; // corpus is embedded and produced an in-scope candidate
      if (exclude.has(m.id)) continue;
      // Stored vectors are unit-normalized: cosine similarity = 1 - d^2/2
      const sim = Math.max(0, Math.min(1, 1 - (r.distance * r.distance) / 2));
      if (sim < minSimilarity) continue; // relevance floor
      scored.push({ m, score: sim });
    }
  }

  // FTS5 fallback ONLY when the vector path could not run (no embedding / no
  // vectors). If vectors existed but nothing cleared the floor, respect that.
  if (scored.length === 0 && vecEligible === 0) {
    const rows = db.prepare(`
      SELECT m.* FROM memories_fts f
      JOIN memories m ON m.rowid = f.rowid
      WHERE memories_fts MATCH @q
        AND m.review_status = 'approved' AND m.superseded_by IS NULL
        AND ${scopeClause}
      ORDER BY f.rank
      LIMIT @lim
    `).all({ q: sanitizeFts5Query(opts.query), project, lim: limit * 3 }) as Record<string, unknown>[];
    for (const row of rows) {
      const m = rowToMemory(row);
      if (exclude.has(m.id)) continue;
      scored.push({ m, score: 0 });
    }
  }

  if (scored.length === 0) return empty;

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  const items: RecalledItem[] = top.map(({ m, score }) => ({ memory: m, score, mode: 'full' as const }));
  const HEADER = '# Recalled Memory\n';
  const parts: string[] = [HEADER.trim()];
  for (const i of items) parts.push(renderFull(i.memory).trim());
  const markdown = parts.join('\n\n');

  return { items, markdown, tokenEstimate: estTokens(markdown), total: scored.length };
}
```

**Step 4: Run the test to confirm it passes**

Run: `cd C:\Fran\claude-nexus && npx vitest run src/core/recall.test.ts`
Expected: PASS (both the existing `recallMemories` suite and the new `recallByQuery` suite).

**Step 5: Commit**

```bash
git add src/core/recall.ts src/core/recall.test.ts
git commit -m "feat(recall): add recallByQuery with cosine relevance floor and dedup"
```

---

### Task 3: Create the UserPromptSubmit runner

**Files:**
- Create: `src/capture/prompt-runner.ts`

**Step 1: Implement**

Create `src/capture/prompt-runner.ts`:

```typescript
/**
 * nexus prompt-runner — the UserPromptSubmit hook entry point.
 *
 * Reads the UserPromptSubmit payload from stdin, embeds the user's prompt,
 * recalls the few most-relevant memories (vector similarity above a floor),
 * dedups against memories already injected this session, and emits them as
 * `additionalContext`. Best-effort: any failure exits 0 with no output and
 * never blocks the prompt.
 *
 * Usage: node dist/capture/prompt-runner.js   (payload on stdin)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { openDatabase } from '../core/database.js';
import { recallByQuery } from '../core/recall.js';
import { getNexusConfig } from '../core/config.js';

/** Project slug from a cwd — mirrors the indexer convention; collapses git
 *  worktrees onto their parent project so recall finds the main checkout's memories. */
function cwdToProjectSlug(cwd: string): string | null {
  const slug = cwd
    .replace(/[:\\/ ._]/g, '-')
    .replace(/-+(claude-)?worktrees?-.*$/, '')
    .replace(/^-+|-+$/g, '');
  return slug.length >= 3 ? slug : null;
}

async function readStdin(): Promise<string> {
  let input = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

const stateDir = join(homedir(), '.claude', 'memories', '.recall-state');

function loadInjected(sessionId: string): Set<string> {
  try {
    const ids = JSON.parse(readFileSync(join(stateDir, `${sessionId}.json`), 'utf-8')) as string[];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch { return new Set(); }
}

function saveInjected(sessionId: string, ids: Set<string>): void {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, `${sessionId}.json`), JSON.stringify([...ids]));
  } catch { /* best-effort */ }
}

async function main(): Promise<void> {
  let payload: { prompt?: string; session_id?: string; cwd?: string } = {};
  try { payload = JSON.parse((await readStdin()) || '{}'); } catch { /* malformed */ }

  const prompt = (payload.prompt || '').trim();
  const sessionId = payload.session_id || '';
  const cfg = getNexusConfig().recall;

  // Gate 1: skip trivial prompts ("yes", "ok", "do it") — nothing to match on.
  if (prompt.split(/\s+/).filter(Boolean).length < cfg.min_words) return;

  const project = cwdToProjectSlug(payload.cwd || process.cwd()) ?? null;
  const injected = sessionId ? loadInjected(sessionId) : new Set<string>();

  const db = openDatabase(process.env.NEXUS_DB);
  try {
    const result = await recallByQuery(db, {
      project,
      query: prompt,
      limit: 5,
      excludeIds: [...injected],
    });
    if (result.items.length === 0 || !result.markdown.trim()) return;

    for (const i of result.items) injected.add(i.memory.id);
    if (sessionId) saveInjected(sessionId, injected);

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: result.markdown,
      },
    }));
  } finally {
    db.close();
  }
}

// Recall is best-effort — a failure must never block the prompt.
main().catch(() => {}).finally(() => process.exit(0));
```

**Step 2: Build and verify it runs**

Run:
```bash
cd C:\Fran\claude-nexus && npm run build && echo '{"prompt":"how does the recall budget work in this project","session_id":"plan-test-1","cwd":"C:\\Fran\\claude-nexus"}' | node dist/capture/prompt-runner.js
```
Expected: either empty output (no memory cleared the floor / Ollama down) or a JSON object with `hookSpecificOutput.additionalContext` containing a `# Recalled Memory` block. Either is a pass — it must exit cleanly with no stack trace.

**Step 3: Verify the short-prompt gate**

Run: `cd C:\Fran\claude-nexus && echo '{"prompt":"yes","session_id":"plan-test-1","cwd":"C:\\Fran\\claude-nexus"}' | node dist/capture/prompt-runner.js`
Expected: no output at all (gated out by min_words).

**Step 4: Commit**

```bash
git add src/capture/prompt-runner.ts
git commit -m "feat(capture): add UserPromptSubmit prompt-runner for prompt-driven recall"
```

---

### Task 4: Remove the SessionStart recall runner

**Files:**
- Delete: `src/capture/load-runner.ts`

**Step 1: Delete the file**

```bash
cd C:\Fran\claude-nexus && git rm src/capture/load-runner.ts
```

(`load-runner.ts` has no test and no importers besides the hook manifest, which Task 5 rewires. `recallMemories` itself stays — it is still imported by `src/mcp/server.ts` and `src/web/server.ts`.)

**Step 2: Verify nothing else imports it**

Run: `cd C:\Fran\claude-nexus && npx tsc --noEmit`
Expected: no errors (no dangling import of `load-runner`).

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor(capture): remove SessionStart load-runner (replaced by prompt-runner)"
```

---

### Task 5: Rewire the hook manifest

The hook manifest is in the local-marketplace plugin **source** (never edit the cache or the `marketplaces/local` clone — they get overwritten).

**Files:**
- Modify: `C:\Fran\LLM_Workflow_Optimization\Local Marketplace Subproject\plugins\claude-nexus\hooks\hooks.json`

**Step 1: Replace the `SessionStart` block with `UserPromptSubmit`**

In that `hooks.json`, replace the `"SessionStart"` array (the block pointing at `dist\capture\load-runner.js`) with:

```json
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node \"C:\\Fran\\claude-nexus\\dist\\capture\\prompt-runner.js\"" }
        ]
      }
    ],
```

Leave the `Stop`, `PreCompact`, and `SessionEnd` blocks unchanged.

**Step 2: Sync to the plugin cache**

The user-scope PostToolUse hook normally auto-syncs after editing plugin source. If it did not fire, run it manually:

```powershell
& "$env:LOCAL_MARKETPLACE\scripts\sync-to-cache.ps1" -Plugins claude-nexus
```

**Step 3: Verify the cache copy updated**

Run: `Get-Content "$env:USERPROFILE\.claude\plugins\cache\local\claude-nexus\*\hooks\hooks.json" | Select-String "UserPromptSubmit"`
Expected: a line containing `UserPromptSubmit`.

**Step 4: Commit (marketplace repo)**

The manifest is in a different git repo. Commit there only if that repo is version-controlled and the user wants it committed:

```powershell
cd "$env:LOCAL_MARKETPLACE"; git add plugins/claude-nexus/hooks/hooks.json; git commit -m "feat(claude-nexus): swap SessionStart recall for UserPromptSubmit prompt-driven recall"
```

**Note for the user:** a hook-manifest change requires a full Claude Code restart (not just `/reload-plugins`) to take effect.

---

### Task 6: Update docs

**Files:**
- Modify: `README.md` (hook table + flow diagram)
- Modify: `CLAUDE.md:68` and `_documents/file-map.md:13` (hooks.json role line)
- Modify: `ARCHITECTURE.md` (SessionStart → UserPromptSubmit references)

**Step 1: Update README hook references**

In `README.md`: change the flow line `SessionStart ─► nexus-load hook ─► budgeted recall ─► injected as context` to describe the UserPromptSubmit prompt-driven recall, and in the hook table replace the `SessionStart | nexus-load` row with `UserPromptSubmit | prompt-runner | Embed prompt, recall top matches above the relevance floor, inject as additionalContext`.

**Step 2: Update the file-map / CLAUDE.md role line**

In both `CLAUDE.md:68` and `_documents/file-map.md:13`, change the `hooks/hooks.json` role to: `wires UserPromptSubmit (prompt-driven recall) and Stop/PreCompact/SessionEnd (capture)`. Update the `src/capture/load-runner.ts` row to `src/capture/prompt-runner.ts | UserPromptSubmit hook — embeds prompt, injects relevance-floored recall`.

**Step 3: Update ARCHITECTURE.md**

In `ARCHITECTURE.md`, update the recall description and the hook-wiring section (the `SessionStart → load-runner.js` lines) to reflect `UserPromptSubmit → prompt-runner.js`, the relevance floor, and per-session dedup.

**Step 4: Record an ADR**

Invoke the `add-adr` skill with summary: "Recall moved from SessionStart bulk dump to UserPromptSubmit prompt-driven semantic recall with a cosine relevance floor and per-session dedup; bulk recallMemories retained for the nexus_recall MCP tool and web API."

**Step 5: Verify**

Run: `cd C:\Fran\claude-nexus && git grep -n "load-runner\|SessionStart.*recall" -- README.md CLAUDE.md _documents/file-map.md ARCHITECTURE.md`
Expected: no stale references to load-runner or SessionStart recall (the `_documents/decisions/` ADR/DDR history files may still mention them — that is fine, they are historical).

**Step 6: Commit**

```bash
git add README.md CLAUDE.md _documents/ ARCHITECTURE.md
git commit -m "docs: document prompt-driven recall, add ADR"
```

---

### Task 7: Full build, test, finish

**Files:** none (verification + handoff)

**Step 1: Full build + test**

Run: `cd C:\Fran\claude-nexus && npm run build && npx vitest run`
Expected: build succeeds; all tests pass.

**Step 2: Hand off**

Invoke the `finish-branch` skill to present merge/PR/keep/discard options for `feat/prompt-driven-recall`.

---

## Post-merge manual step (user)

Restart Claude Code fully so the new `UserPromptSubmit` hook loads. Then in a fresh session: confirm there is **no** "Recalled Memory" dump at session start, and that asking a substantive, on-topic question injects a `# Recalled Memory` block. Tune `min_similarity` / `min_words` in `extraction_models.yaml` if recall is too eager or too quiet.
