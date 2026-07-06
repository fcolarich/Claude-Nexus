# nexus_remember_batch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `dispatch-agents` skill to implement this plan task-by-task.

**Goal:** Add a batch memory-write MCP tool `nexus_remember_batch` so bulk pointer emission (e.g. 16 recipe pointers) is ONE MCP call instead of N sequential round-trips.

**Architecture:** A new service helper `rememberBatch(db, items, embed?)` in `src/core/memories.ts` wraps all `insertMemory` calls in ONE `db.transaction()` with per-item try/catch (one bad item does not abort the batch), returning three-status per-item results (`written`/`duplicate`/`error`). A thin new MCP tool `nexus_remember_batch` in `src/mcp/server.ts` resolves per-item effective values (`item.field ?? topLevelDefault ?? builtin`), maps to `MemoryInput`, calls the helper, and fires best-effort embedding after commit. `nexus_remember` is left byte-for-byte untouched (zero migration risk). Knowledge-only — the task subsystem is gone.

**Tech Stack:** TypeScript (ESM, Node 22+), better-sqlite3, zod, @modelcontextprotocol/sdk, Vitest.

**Repo note:** This project branches IN PLACE (no git worktree — hook paths are hardcoded to `C:\Fran\claude-nexus`). Branch `feat/nexus-remember-batch` is already created and checked out. `dist/` is TRACKED — after `npm run build`, stage & commit `dist/` too. Use PowerShell for Windows-path commands.

---

### Task 1: `rememberBatch` helper + types in `src/core/memories.ts`

**Files:**
- Modify: `C:\Fran\claude-nexus\src\core\memories.ts` (add after `insertMemory`, ~line 89)

**Step 1: Write the failing test**

Create `C:\Fran\claude-nexus\src\core\memories.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { rememberBatch, getMemory, type BatchMemoryItem } from './memories.js';

/** Minimal in-memory DB with schema, no embedding (embed injected as no-op). */
function freshDb() {
  const db = openDatabase(':memory:');
  initializeSchema(db);
  return db;
}

const noEmbed = async () => false; // skip embedding in unit tests

function item(overrides: Partial<BatchMemoryItem> = {}): BatchMemoryItem {
  return {
    title: 'T',
    body: 'unique body ' + Math.random(),
    memory_type: 'reference',
    scope: 'global',
    project: null,
    confidence: 0.85,
    decay_class: 'stable',
    review_status: 'approved',
    source_session_id: null,
    discovered_from: null,
    tags: [],
    load_at_init: false,
    ...overrides,
  };
}

describe('rememberBatch', () => {
  it('reports written vs duplicate per item', async () => {
    const db = freshDb();
    const a = item({ body: 'body-A' });
    const b = item({ body: 'body-B' });
    const res = await rememberBatch(db, [a, b, a], noEmbed);
    expect(res.results.map(r => r.status)).toEqual(['written', 'written', 'duplicate']);
    expect(res.results[0].id).toBeTruthy();
    expect(res.results[2].id).toBe(res.results[0].id); // content-addressed dedup
    db.close();
  });

  it('one throwing item does not abort the rest', async () => {
    const db = freshDb();
    // memory_type null triggers a NOT NULL constraint throw inside insertMemory
    const bad = item({ body: 'body-bad', memory_type: null as unknown as BatchMemoryItem['memory_type'] });
    const good = item({ body: 'body-good' });
    const res = await rememberBatch(db, [bad, good], noEmbed);
    expect(res.results[0].status).toBe('error');
    expect(res.results[0].reason).toBeTruthy();
    expect(res.results[1].status).toBe('written');
    // the good one is actually persisted
    expect(getMemory(db, res.results[1].id!)).toBeTruthy();
    db.close();
  });

  it('embeds each written item best-effort', async () => {
    const db = freshDb();
    const embedded: string[] = [];
    const embed = async (id: string) => { embedded.push(id); return true; };
    const res = await rememberBatch(db, [item({ body: 'e1' }), item({ body: 'e2' })], embed);
    expect(embedded.sort()).toEqual(res.results.map(r => r.id!).sort());
    db.close();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/memories.test.ts`
Expected: FAIL — `rememberBatch`/`BatchMemoryItem` not exported.

**Step 3: Write minimal implementation**

In `C:\Fran\claude-nexus\src\core\memories.ts`, add these exports immediately after `insertMemory` (after line 89). Note `embedMemory` is already defined later in the file — the default embed adapter references it, so keep the new code below or rely on hoisting (function declarations hoist, so ordering is fine).

```typescript
/** One fully-resolved item for a batch write (defaults already merged by the caller). */
export type BatchMemoryItem = MemoryInput;

/** Per-item outcome of a batch write. */
export interface BatchResult {
  index: number;
  id?: string;
  status: 'written' | 'duplicate' | 'error';
  reason?: string;
}

/**
 * Batch-insert memories in ONE transaction (single fsync) with per-item
 * try/catch — a throwing item is recorded as status:'error' and does NOT abort
 * the rest. Embedding runs best-effort AFTER commit (outside the transaction).
 * `embed` is injectable for tests; defaults to embedMemory against this db.
 */
export async function rememberBatch(
  db: Database.Database,
  items: BatchMemoryItem[],
  embed: (id: string) => Promise<boolean> = (id) => embedMemory(db, id),
): Promise<{ results: BatchResult[] }> {
  const results: BatchResult[] = new Array(items.length);

  db.transaction(() => {
    items.forEach((input, index) => {
      try {
        const { id, inserted } = insertMemory(db, input);
        results[index] = { index, id, status: inserted ? 'written' : 'duplicate' };
      } catch (err) {
        results[index] = { index, status: 'error', reason: err instanceof Error ? err.message : String(err) };
      }
    });
  })();

  // Best-effort embed for every newly-written id, after the txn commits.
  await Promise.all(
    results
      .filter((r) => r.status === 'written' && r.id)
      .map((r) => embed(r.id!).catch(() => false)),
  );

  return { results };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/memories.test.ts`
Expected: PASS (3 tests).

**Step 5: Commit**

```powershell
git add src/core/memories.ts src/core/memories.test.ts
git commit -m "feat(memories): rememberBatch helper — single-txn batch write with per-item results"
```

---

### Task 2: `nexus_remember_batch` MCP tool in `src/mcp/server.ts`

**Files:**
- Modify: `C:\Fran\claude-nexus\src\mcp\server.ts` (add new `server.tool(...)` block immediately after the `nexus_remember` tool, which ends at line 377; import `rememberBatch` on line 30)

**Step 1: Add the import**

Change line 30 from:
```typescript
import { verifyMemory, recordFeedback, insertMemory, embedMemory } from '../core/memories.js';
```
to:
```typescript
import { verifyMemory, recordFeedback, insertMemory, embedMemory, rememberBatch } from '../core/memories.js';
```

**Step 2: Add the tool**

Insert this block after line 377 (the closing `);` of `nexus_remember`), before the `// ── nexus_stats ──` comment. The decay map and `resolveProjectFromCwd` are already in scope in this file.

```typescript
// ── nexus_remember_batch ─────────────────────────────────────────────

server.tool(
  'nexus_remember_batch',
  'Store MANY memories in ONE call — batch equivalent of nexus_remember for bulk pointer emission (e.g. a set of recipe/best-practice pointers). Each item may set its own fields; top-level fields act as defaults when an item omits them (effective = item ?? default ?? builtin). Best-effort: a failed item is reported, not fatal — the on-disk doc file is authoritative.',
  {
    memories: z.array(z.object({
      title:        z.string().describe('Short title for the memory'),
      content:      z.string().describe('Body — 1–4 self-contained sentences with the durable lesson and its why'),
      scope:        z.enum(['global', 'shared', 'project']).optional().describe('Overrides the top-level scope default for this item'),
      memory_type:  z.enum(['preference', 'convention', 'failure', 'correction', 'decision', 'insight', 'tool_quirk', 'reference', 'handoff']).optional().describe('Overrides the top-level memory_type default'),
      tags:         z.array(z.string()).optional().describe('Tags — overrides the top-level tags default'),
      confidence:   z.coerce.number().min(0).max(1).optional().describe('Intrinsic confidence 0–1 — overrides the top-level default'),
      load_at_init: z.boolean().optional().describe('Overrides the top-level load_at_init default'),
      project:      z.string().optional().describe('Project slug — overrides the top-level/cwd-derived project for this item'),
    })).min(1).max(50).describe('1–50 memories to write in one transaction'),
    // Top-level defaults applied to any item that omits the field.
    scope:        z.enum(['global', 'shared', 'project']).optional().describe('Default scope for all items (default: project)'),
    memory_type:  z.enum(['preference', 'convention', 'failure', 'correction', 'decision', 'insight', 'tool_quirk', 'reference', 'handoff']).optional().describe('Default memory_type for all items (default: insight)'),
    tags:         z.array(z.string()).optional().describe('Default tags for all items'),
    confidence:   z.coerce.number().min(0).max(1).optional().describe('Default confidence for all items (default: 0.85)'),
    load_at_init: z.boolean().optional().describe('Default load_at_init for all items (default: false)'),
    project:      z.string().optional().describe('Default project slug (prefer cwd)'),
    cwd:          z.string().optional().describe('Caller working directory — derives the default project slug automatically'),
  },
  async ({ memories, scope, memory_type, tags, confidence, load_at_init, project, cwd }) => {
    const defaultProject = project ?? (cwd ? resolveProjectFromCwd(cwd) : undefined);

    const items = memories.map((m) => {
      const resolvedMemType: MemoryType = m.memory_type ?? memory_type ?? 'insight';
      const effProject = m.project ?? defaultProject ?? null;
      return {
        title: m.title,
        body: m.content,
        memory_type: resolvedMemType,
        scope: (m.scope ?? scope ?? 'project'),
        project: effProject,
        confidence: m.confidence ?? confidence ?? 0.85,
        decay_class: MEMORY_TYPE_DECAY[resolvedMemType],
        review_status: 'approved' as const,
        source_session_id: null,
        discovered_from: null,
        tags: m.tags ?? tags ?? [],
        load_at_init: m.load_at_init ?? load_at_init ?? false,
      };
    });

    const { results } = await rememberBatch(db, items);

    const written = results.filter(r => r.status === 'written').length;
    const duplicates = results.filter(r => r.status === 'duplicate').length;
    const errors = results.filter(r => r.status === 'error').length;

    const lines = results.map((r) => {
      const label = memories[r.index].title;
      if (r.status === 'error') return `  [${r.index}] ERROR: ${label} — ${r.reason}`;
      return `  [${r.index}] ${r.status}: ${label} (${r.id})`;
    });

    return { content: [{ type: 'text', text: `Batch: ${written} written, ${duplicates} duplicates, ${errors} errors\n${lines.join('\n')}` }] };
  }
);
```

**Step 3: Verify it compiles**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

**Step 4: Commit**

```powershell
git add src/mcp/server.ts
git commit -m "feat(mcp): add nexus_remember_batch tool — bulk memory write in one call"
```

---

### Task 3: Schema-level test — batch >50 is rejected

**Files:**
- Modify: `C:\Fran\claude-nexus\src\core\memories.test.ts` (add a describe block validating the max-50 constraint at the zod level)

The tool's zod schema is defined inline in server.ts (importing it triggers server startup side-effects), so test the constraint directly against a local mirror of the `.min(1).max(50)` array rule — this documents and locks the contract.

**Step 1: Write the test**

Append to `C:\Fran\claude-nexus\src\core\memories.test.ts`:

```typescript
import { z } from 'zod';

describe('nexus_remember_batch schema contract', () => {
  // Mirror of the tool's array constraint — locks the 1..50 bound.
  const memoriesSchema = z.array(z.object({ title: z.string(), content: z.string() })).min(1).max(50);

  it('rejects an empty batch', () => {
    expect(memoriesSchema.safeParse([]).success).toBe(false);
  });

  it('accepts exactly 50', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => ({ title: `t${i}`, content: `c${i}` }));
    expect(memoriesSchema.safeParse(fifty).success).toBe(true);
  });

  it('rejects 51', () => {
    const fiftyOne = Array.from({ length: 51 }, (_, i) => ({ title: `t${i}`, content: `c${i}` }));
    expect(memoriesSchema.safeParse(fiftyOne).success).toBe(false);
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/core/memories.test.ts`
Expected: PASS (all describe blocks).

**Step 3: Commit**

```powershell
git add src/core/memories.test.ts
git commit -m "test(memories): lock nexus_remember_batch 1..50 array contract"
```

---

### Task 4: Full test + build gate

**Files:** none (verification only)

**Step 1: Run full suite**

Run: `npx vitest run`
Expected: all tests pass (baseline was 115/115; new tests add to that count). If any pre-existing test fails unrelated to this change, note it but do not fix outside scope.

**Step 2: Build**

Run: `npm run build`
Expected: exits 0.

**Step 3: Commit compiled dist/**

`dist/` is tracked. Stage the recompiled outputs (`dist/core/memories.js`, `dist/mcp/server.js`, and any `.js.map`). There are no removed sources this change, so no stale-artifact deletion needed — but verify with `git status` that only expected dist files changed.

```powershell
git add dist/
git commit -m "build: compile nexus_remember_batch to dist"
```

---

### Task 5: ADR for the new MCP surface

**Files:**
- Create (via skill): `_documents/decisions/adr-011-*.md` + rebuilt index

**Step 1: Record the ADR**

Invoke the `add-adr` skill with a summary along these lines:

> Add `nexus_remember_batch` as a SEPARATE MCP tool (not an overload of `nexus_remember`). Reason: making `title`/`content`/`scope` optional to allow a `memories` array would break zod schema strictness ("fields optional only when X" is inexpressible), so a separate tool keeps `nexus_remember` byte-for-byte untouched (zero migration risk). Logic extracted into `rememberBatch(db, items)` in `memories.ts` per the "logic in services" convention: one `db.transaction()` (single fsync vs N), per-item try/catch so one bad item doesn't abort the batch, three-status per-item results (written/duplicate/error) reusing `insertMemory`'s content-addressed dedup. Top-level fields act as defaults; per-item fields override (effective = item ?? default ?? builtin). Best-effort embed after commit; on-disk doc file authoritative. Max 50 items per call.

Let the skill assign the number and rebuild the index.

**Step 2: Verify + commit**

The `add-adr` skill writes `_documents/decisions/adr-011-*.md`, updates `_documents/decisions.db`, and regenerates `_documents/architecture.md`. Commit all three (the decisions.db binary must be committed with the ADR to keep the index consistent).

```powershell
git add _documents/decisions/ _documents/decisions.db _documents/architecture.md
git commit -m "docs: ADR-011 nexus_remember_batch MCP tool"
```

---

### Task 6: Bump tool count + tool listing in docs

**Files:**
- Modify: `C:\Fran\claude-nexus\README.md` (line 102 area — add row; line 128 — 17→18)
- Modify: `C:\Fran\claude-nexus\CLAUDE.md` (line 65 — 17→18)
- Modify: `C:\Fran\claude-nexus\_documents\file-map.md` (line 10 — 17→18)

**Step 1: README — add tool row + bump count**

In `README.md`, after the `nexus_remember` row (line 102), add:
```markdown
| `nexus_remember_batch` | Store many memories in one call — batch write for bulk pointer emission |
```
And change line 128 `stdio transport, 17 tools.` → `stdio transport, 18 tools.`

**Step 2: CLAUDE.md — bump count**

Change line 65 `MCP server — 17 tools exposed over stdio transport` → `MCP server — 18 tools exposed over stdio transport`.

**Step 3: file-map.md — bump count**

Change line 10 `MCP server — 17 tools exposed over stdio transport` → `MCP server — 18 tools exposed over stdio transport`.

**Step 4: Verify**

Run: `Select-String -Path README.md,CLAUDE.md,_documents\file-map.md -Pattern '17 tools','18 tools'`
Expected: no remaining `17 tools`; three `18 tools` hits (README line 128, CLAUDE line 65, file-map line 10). README's tool table now lists `nexus_remember_batch`.

**Step 5: Commit**

```powershell
git add README.md CLAUDE.md _documents/file-map.md
git commit -m "docs: reflect nexus_remember_batch (17->18 tools)"
```

---

### Task 7: Finish the branch

Invoke the `finish-branch` skill. This project branches in place (no worktree), so `finish-branch` should present merge/PR/keep options for `feat/nexus-remember-batch` → `main`. Do NOT push to the remote unless the user explicitly asks.

**Final follow-up (flag for the user — do NOT auto-execute):** Update pointer-emission callers/conventions to USE `nexus_remember_batch`: the marketplace unity-knowledge skills (`add-recipe` / `add-best-practice` / `add-snippet`) under `$LOCAL_MARKETPLACE`, and the standing conventions "Emit Nexus pointers for bulk recipe batches" / "Emit Nexus pointers after Knowledge/Recipe writes". A single-entry batch call is fine for the 1-item case. This touches a separate repo (the local marketplace) and should be a follow-up task.
