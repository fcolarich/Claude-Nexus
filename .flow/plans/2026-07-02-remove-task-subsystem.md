# Remove Nexus Task Subsystem Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `dispatch-agents` skill to implement this plan task-by-task.

**Goal:** Fully remove the task subsystem from Claude Nexus — MCP tools, web routes, dashboard view, parser/indexer support, TypeScript types, and the database columns/rows — leaving `nexus_remember` as a knowledge-only tool.

**Architecture:** Delete task code from each layer (MCP → web → frontend → indexer/parser → types), then add an append-only schema migration (v7) that recreates the `atoms` table without the five task columns and purges `atom_type='task'` rows. Migrations v1–v6 are left untouched (never rewrite history); v7 converges fresh and existing DBs to the task-free shape. A one-time disk cleanup removes orphaned `task_*.md` files.

**Tech Stack:** TypeScript (ESM, Node 22+), better-sqlite3 + FTS5 + sqlite-vec, Express 5, Svelte 5 + Vite, Vitest.

**Working-branch note:** This project branches **in place** — hook execution paths are hardcoded to `C:\Fran\claude-nexus`, so do NOT use a git worktree. Create a normal branch: `git checkout -b feat/remove-task-subsystem`.

**Ordering rationale:** Consumers of the task types are removed first (Tasks 1–4) so that removing the types themselves (Task 5) leaves no dangling references and the project keeps type-checking. The DB migration (Task 6) comes after code so the running server never reads columns that no longer exist in the type. Each task ends with a commit.

**Pre-flight (run once before Task 1):**
```powershell
git checkout -b feat/remove-task-subsystem
```

---

### Task 1: Remove task tools from the MCP server

**Files:**
- Modify: `src/mcp/server.ts`

**Step 1: Delete the three task tools + helpers (one contiguous block)**

Delete the entire block from the `// ── nexus_tasks_create ───` comment (line ~431) through the end of the `nexus_task_update` tool's closing `);` (line ~707), immediately before `// ── nexus_stats ───` (line ~709). This removes: `nexus_tasks_create`, the `resolveEffectiveStatus` / `toTaskAtom` helpers, `nexus_tasks`, and `nexus_task_update` in one cut.

**Step 2: Strip the task path out of `nexus_remember`**

In the `nexus_remember` tool definition:
- In the input schema, remove `'task'` from the `atom_type` enum (leave the other legacy values):
  ```ts
  atom_type: z.enum(['memory', 'feedback', 'reference', 'project_note', 'architecture']).optional()
    .describe('Legacy atom type — use memory_type instead for knowledge.'),
  ```
- Delete the five task-specific schema fields: `status`, `priority`, `blocks`, `blocked_by`, `discovered_from` (the `// Task-specific fields` group).
- In the async handler signature, remove `status, priority, blocks, blocked_by, discovered_from` from the destructured params.
- Delete the entire `const isTask = atom_type === 'task';` line and the whole `// ── Task path (atoms table, file-based) ───` branch (`if (isTask) { ... }`), keeping only the knowledge path. Also update the tool description to drop the task mention:
  ```ts
  'Store knowledge in the memories store — writes to the memories table so it is searchable by nexus_search and recallable by nexus_recall.',
  ```

**Step 3: Remove now-unused imports**

Check the top of `src/mcp/server.ts` for imports that are now unused (e.g. `TaskAtom`, `TaskStatus`, and possibly `Atom` if no longer referenced elsewhere in the file). Remove only the ones no longer used. Leave `readFile`/`writeFile`/`matter` if still used by other tools.

**Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors originating in `src/mcp/server.ts`. (Errors may still appear in other files not yet edited — that is fine at this stage; confirm none reference `server.ts`.)

Run: `Select-String -Path src/mcp/server.ts -Pattern "nexus_tasks|toTaskAtom|resolveEffectiveStatus|isTask"`
Expected: no matches.

**Step 5: Commit**

```powershell
git add src/mcp/server.ts
git commit -m "refactor(mcp): remove task tools and nexus_remember task path"
```

---

### Task 2: Remove task routes from the web server

**Files:**
- Modify: `src/web/server.ts`

**Step 1: Delete the Tasks route block**

Delete the entire block from the `// --- Tasks ---` comment (line ~300) through the closing `});` of `app.post('/api/tasks', ...)` (line ~441), immediately before `// --- Search ---` (line ~443). This removes the `resolveEffectiveStatus` / `toTaskResponse` helpers and the GET/PATCH/POST `/api/tasks` handlers.

**Step 2: Remove now-unused imports**

In the import on line ~28, drop `TaskAtom` and `TaskStatus`:
```ts
import type { Atom, AtomLink, Session } from '../core/types.js';
```
(Keep `Atom`, `AtomLink`, `Session` — they are used elsewhere in the file. Verify before removing any.)

**Step 3: Verify**

Run: `Select-String -Path src/web/server.ts -Pattern "/api/tasks|toTaskResponse|TaskAtom|TaskStatus"`
Expected: no matches.

Run: `npx tsc --noEmit`
Expected: no errors originating in `src/web/server.ts`.

**Step 4: Commit**

```powershell
git add src/web/server.ts
git commit -m "refactor(web): remove /api/tasks routes"
```

---

### Task 3: Remove the Tasks view and frontend wiring

**Files:**
- Delete: `src/frontend/views/Tasks.svelte`
- Modify: `src/frontend/App.svelte`
- Modify: `src/frontend/components/Sidebar.svelte`
- Modify: `src/frontend/lib/router.ts`
- Modify: `src/frontend/lib/api.ts`

**Step 1: Delete the view**

```powershell
Remove-Item src/frontend/views/Tasks.svelte
```

**Step 2: `App.svelte`** — remove the import (line 12) `import Tasks from "./views/Tasks.svelte";` and the route branch (lines 35–36):
```svelte
    {:else if $currentRoute === "tasks"}
      <Tasks />
```

**Step 3: `Sidebar.svelte`** — remove the nav item (line 7):
```ts
    { route: "tasks", label: "Tasks", icon: "✓" },
```

**Step 4: `router.ts`** — remove `"tasks"` from the `Route` union (line 12). The union should end:
```ts
  | "skills";
```

**Step 5: `api.ts`** — remove three type blocks and three methods:
- Delete `export type TaskStatus = ...` (line 193), `export interface TaskItem { ... }` (lines 195–208), and `export interface CreateTaskParams { ... }` (lines 210–218).
- Delete the `tasks`, `updateTask`, and `createTask` methods (lines 270–282). Ensure the method above them (`createMemory`, line 269) still ends with a comma and the object closes cleanly with `};`.

**Step 6: Verify**

Run: `Select-String -Path src/frontend -Pattern "task" -Recurse` (case-insensitive by default)
Expected: no matches referencing the tasks route, `TaskItem`, `TaskStatus`, `CreateTaskParams`, or `/api/tasks`.

Run: `npm run build` (compiles the frontend via Vite + svelte-check)
Expected: build succeeds, no errors about missing `Tasks`, `tasks` route, or task types.

**Step 7: Commit**

```powershell
git add src/frontend
git commit -m "refactor(frontend): remove Tasks view, route, nav, and api methods"
```

---

### Task 4: Remove task support from parser and indexer

**Files:**
- Modify: `src/indexer/parser.ts`
- Modify: `src/indexer/indexer.ts`

**Step 1: `parser.ts` — remove the frontmatter task mapping**

In `inferAtomType`, delete line 29:
```ts
  if (frontmatterType === 'task') return 'task';
```

**Step 2: `parser.ts` — remove task-field extraction and the pushed fields**

Delete the task-field extraction block (lines 227–240: the five `let taskX` declarations and the `if (atomType === 'task' && ...)` block).

In the `atoms.push({ ... })` object, delete the five task fields (lines 258–262):
```ts
      status: taskStatus as any,
      priority: taskPriority,
      blocks: taskBlocks,
      blocked_by: taskBlockedBy,
      discovered_from: taskDiscoveredFrom,
```

Simplify the now-stale comment above `content_hash` (lines 253–255) to:
```ts
      // First section hash covers the full raw file so frontmatter changes are
      // detected by the unchanged check. Subsequent sections hash their own body.
```

**Step 3: `indexer.ts` — remove task columns from the upsert statement**

In the `upsertAtom` prepared statement (lines 39–57):
- INSERT column list (line 40): remove `status, priority, blocks, blocked_by, discovered_from`.
- VALUES list (line 41): remove `@status, @priority, @blocks, @blocked_by, @discovered_from`.
- `ON CONFLICT DO UPDATE SET` (lines 51–55): remove the `status = @status,` through `discovered_from = @discovered_from,` lines.

Resulting statement (for reference):
```ts
    upsertAtom: db.prepare(`
      INSERT INTO atoms (id, title, body, atom_type, scope, source_path, source_type, project, tags, content_hash, frontmatter, updated_at, load_at_init)
      VALUES (@id, @title, @body, @atom_type, @scope, @source_path, @source_type, @project, @tags, @content_hash, @frontmatter, datetime('now'), @load_at_init)
      ON CONFLICT(id) DO UPDATE SET
        title = @title,
        body = @body,
        atom_type = @atom_type,
        scope = @scope,
        tags = @tags,
        content_hash = @content_hash,
        frontmatter = @frontmatter,
        updated_at = datetime('now'),
        load_at_init = @load_at_init
    `),
```

**Step 4: `indexer.ts` — remove task fields from the run params**

In the `stmts.upsertAtom.run({ ... })` object (lines 139–143), delete:
```ts
      status: atom.status ?? null,
      priority: atom.priority ?? null,
      blocks: atom.blocks ?? null,
      blocked_by: atom.blocked_by ?? null,
      discovered_from: atom.discovered_from ?? null,
```

**Step 5: Verify**

Run: `Select-String -Path src/indexer -Pattern "task|blocked_by|discovered_from|priority|blocks" -Recurse`
Expected: no matches (the only remaining "priority" would be in unrelated comments — confirm none reference atom task fields).

Note: `npx tsc --noEmit` will still report errors here referencing `atom.status`/etc. only if the `Atom` type still has them — it does until Task 5, so these edits (which *stop* referencing them) are correct. Full type-check happens in Task 5.

**Step 6: Commit**

```powershell
git add src/indexer/parser.ts src/indexer/indexer.ts
git commit -m "refactor(indexer): drop task fields from parser and atoms upsert"
```

---

### Task 5: Remove task types

**Files:**
- Modify: `src/core/types.ts`

**Step 1: Remove the type declarations and Atom fields**

- Line 1: remove `'task'` from `AtomType`:
  ```ts
  export type AtomType = 'memory' | 'agent' | 'skill' | 'plan' | 'feedback' | 'reference' | 'project_note' | 'architecture';
  ```
- Line 2: delete `export type TaskStatus = 'ready' | 'in_progress' | 'blocked' | 'done';`.
- In `interface Atom`, delete the task-specific fields block (lines 29–34): the `// Task-specific fields` comment and `status`, `priority`, `blocks`, `blocked_by`, `discovered_from`. Keep `load_at_init` (line 35).
- Delete the entire `export interface TaskAtom { ... }` (lines 38–51).

`ParsedFile.atoms` (`Omit<Atom, ...>`) inherits the removal automatically — no change needed there.

**Step 2: Verify — full project type-check**

Run: `npx tsc --noEmit`
Expected: **zero errors** across the whole project. (If any remain, they point to a task reference missed in Tasks 1–4 — fix in the owning file and re-run.)

Run: `Select-String -Path src/core/types.ts -Pattern "TaskStatus|TaskAtom|'task'"`
Expected: no matches.

**Step 3: Commit**

```powershell
git add src/core/types.ts
git commit -m "refactor(types): remove TaskStatus, TaskAtom, and Atom task fields"
```

---

### Task 6: Add schema migration v7 (drop task columns + purge task rows)

**Files:**
- Modify: `src/core/database.ts`

**Step 1: Register the migration**

In the `MIGRATIONS` array (line ~51), append:
```ts
  { version: 7, name: 'remove-task-support', up: migrateRemoveTaskSupport },
```

**Step 2: Implement the migration function**

Add this function near the other migration functions (e.g. after `migrateTaskSupport`, around line 284). It recreates `atoms` without the five task columns and without `'task'` in the CHECK, copying only non-task rows, then restores FTS + triggers + indexes and clears stale vectors.

```ts
// ── Migration 7: remove task support ─────────────────────────────────
// Drops the five task columns (status, priority, blocks, blocked_by,
// discovered_from) from atoms, removes 'task' from the atom_type CHECK, and
// purges task rows. Append-only: earlier migrations that added task support are
// left intact; this converges fresh and existing DBs to the task-free shape.
function migrateRemoveTaskSupport(db: Database.Database): void {
  const schemaRow = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='atoms'`
  ).get() as { sql: string } | undefined;

  if (!schemaRow) return;
  // Idempotent: if already task-free, nothing to do.
  if (!schemaRow.sql.includes("'task'") && !schemaRow.sql.includes('blocked_by')) return;

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE atoms_new (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        body          TEXT NOT NULL,
        atom_type     TEXT NOT NULL CHECK(atom_type IN (
          'memory', 'agent', 'skill', 'plan', 'feedback', 'reference', 'project_note', 'architecture'
        )),
        scope         TEXT NOT NULL DEFAULT 'project' CHECK(scope IN ('global', 'shared', 'project')),
        source_path   TEXT NOT NULL,
        source_type   TEXT NOT NULL CHECK(source_type IN (
          'memory_file', 'agent_def', 'skill_def', 'plan_file', 'nexus_native'
        )),
        project       TEXT,
        tags          TEXT NOT NULL DEFAULT '[]',
        content_hash  TEXT NOT NULL,
        frontmatter   TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
        load_at_init  INTEGER NOT NULL DEFAULT 0
      )`);

      // Copy every non-task atom; task rows are purged by exclusion.
      db.exec(`INSERT INTO atoms_new
        (id, title, body, atom_type, scope, source_path, source_type, project, tags, content_hash, frontmatter, created_at, updated_at, load_at_init)
        SELECT id, title, body, atom_type, scope, source_path, source_type, project, tags, content_hash, frontmatter, created_at, updated_at, load_at_init
        FROM atoms WHERE atom_type != 'task'`);

      db.exec(`DROP TRIGGER IF EXISTS atoms_ai`);
      db.exec(`DROP TRIGGER IF EXISTS atoms_ad`);
      db.exec(`DROP TRIGGER IF EXISTS atoms_au`);
      db.exec(`DROP TRIGGER IF EXISTS atoms_vec_ad`);
      db.exec(`DROP TABLE IF EXISTS atoms_fts`);
      db.exec(`DROP TABLE atoms`);
      db.exec(`ALTER TABLE atoms_new RENAME TO atoms`);

      // Recreate FTS mirror + sync triggers (dropped with the old table).
      db.exec(`CREATE VIRTUAL TABLE atoms_fts USING fts5(
        title, body, tags,
        content='atoms',
        content_rowid='rowid',
        tokenize='porter unicode61'
      )`);
      db.exec(`CREATE TRIGGER atoms_ai AFTER INSERT ON atoms BEGIN
        INSERT INTO atoms_fts(rowid, title, body, tags)
        VALUES (new.rowid, new.title, new.body, new.tags);
      END`);
      db.exec(`CREATE TRIGGER atoms_ad AFTER DELETE ON atoms BEGIN
        INSERT INTO atoms_fts(atoms_fts, rowid, title, body, tags)
        VALUES ('delete', old.rowid, old.title, old.body, old.tags);
      END`);
      db.exec(`CREATE TRIGGER atoms_au AFTER UPDATE ON atoms BEGIN
        INSERT INTO atoms_fts(atoms_fts, rowid, title, body, tags)
        VALUES ('delete', old.rowid, old.title, old.body, old.tags);
        INSERT INTO atoms_fts(rowid, title, body, tags)
        VALUES (new.rowid, new.title, new.body, new.tags);
      END`);
      db.exec(`INSERT INTO atoms_fts(atoms_fts) VALUES('rebuild')`);

      // Recreate atom indexes (dropped with the old table).
      db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_project ON atoms(project)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_type ON atoms(atom_type)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_scope ON atoms(scope)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_source ON atoms(source_path)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_hash ON atoms(content_hash)`);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  // Recreate the vec-delete trigger and clear stale vectors (rowids changed).
  // Guarded: vec0 may be unavailable.
  try {
    db.exec(`DELETE FROM atoms_vec`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS atoms_vec_ad AFTER DELETE ON atoms BEGIN
      DELETE FROM atoms_vec WHERE rowid = old.rowid;
    END`);
  } catch { /* vector search disabled — embeddings rebuild on next reindex */ }
}
```

**Step 3: Verify — build and version bump**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `node -e "const {openDatabase,initializeSchema,LATEST_SCHEMA_VERSION}=await import('./dist/core/database.js'); const db=openDatabase(':memory:'); initializeSchema(db); const cols=db.prepare('PRAGMA table_info(atoms)').all().map(c=>c.name); console.log('LATEST', LATEST_SCHEMA_VERSION); console.log('has task cols', cols.some(c=>['status','priority','blocks','blocked_by','discovered_from'].includes(c)));"`
(First run `npm run build` so `dist/` exists.)
Expected: `LATEST 7` and `has task cols false`.

**Step 4: Commit**

```powershell
git add src/core/database.ts
git commit -m "feat(db): migration v7 removes task columns and purges task rows"
```

---

### Task 7: Update tests (delete task test, add migration test)

**Files:**
- Delete: `src/tasks.test.ts`
- Modify: `src/core/database.test.ts`

This task hits a Testing exception (schema migration = non-trivial logic + data correctness), so it is test-warranted.

**Step 1: Delete the obsolete task test**

```powershell
Remove-Item src/tasks.test.ts
```
(The entire file tested `resolveEffectiveStatus`, which no longer exists.)

**Step 2: Write the failing migration test**

Append to `src/core/database.test.ts` (inside the existing top-level `describe` block, or add a new one). This seeds a task row on a legacy schema, runs migrations, and asserts task columns and rows are gone while non-task atoms survive:

```ts
  it('migration v7 removes task columns and purges task rows', () => {
    const db = openDatabase(':memory:');

    // Legacy schema WITH task support (pre-v7), matching the old atoms table.
    db.exec(`CREATE TABLE atoms (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
      atom_type TEXT NOT NULL CHECK(atom_type IN (
        'memory','agent','skill','plan','feedback','reference','project_note','architecture','task')),
      scope TEXT NOT NULL DEFAULT 'project', source_path TEXT NOT NULL,
      source_type TEXT NOT NULL, project TEXT, tags TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT NOT NULL, frontmatter TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT, priority INTEGER, blocks TEXT, blocked_by TEXT,
      discovered_from TEXT, load_at_init INTEGER NOT NULL DEFAULT 0
    )`);
    const insert = db.prepare(
      `INSERT INTO atoms (id, title, body, atom_type, scope, source_path, source_type, project, content_hash, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run('mem1', 'A memory', 'body', 'memory', 'project', '/p/m.md', 'memory_file', 'proj', 'h1', null);
    insert.run('task1', 'A task', 'body', 'task', 'project', '/p/t.md', 'nexus_native', 'proj', 'h2', 'ready');

    initializeSchema(db);

    const cols = (db.prepare(`PRAGMA table_info(atoms)`).all() as { name: string }[]).map(c => c.name);
    for (const taskCol of ['status', 'priority', 'blocks', 'blocked_by', 'discovered_from']) {
      expect(cols).not.toContain(taskCol);
    }
    const taskCount = (db.prepare(`SELECT COUNT(*) AS c FROM atoms WHERE atom_type = 'task'`).get() as { c: number }).c;
    expect(taskCount).toBe(0);
    const memCount = (db.prepare(`SELECT COUNT(*) AS c FROM atoms WHERE id = 'mem1'`).get() as { c: number }).c;
    expect(memCount).toBe(1);

    db.close();
  });
```

**Step 3: Run to confirm it passes (v7 already implemented in Task 6)**

Run: `npx vitest run src/core/database.test.ts`
Expected: PASS, including the new test. (If v7 were missing it would fail on the column/row assertions — this proves the migration.)

**Step 4: Run the full suite**

Run: `npx vitest run`
Expected: all pass; no reference to the deleted `src/tasks.test.ts`.

**Step 5: Commit**

```powershell
git add src/tasks.test.ts src/core/database.test.ts
git commit -m "test(db): drop task test, add v7 migration test"
```

---

### Task 8: Full build and runtime verification

**Files:** none (verification only)

**Step 1: Clean build**

Run: `npm run build`
Expected: `tsc` → `dist/` and the frontend build both succeed with no errors.

**Step 2: Confirm the MCP server boots and single-item remember still works**

Run: `node -e "await import('./dist/mcp/server.js').then(()=>console.log('mcp import OK'))"`
Expected: `mcp import OK` (no throw from a missing task symbol).

**Step 3: Confirm no task surface remains in compiled output**

Run: `Select-String -Path dist -Pattern "nexus_tasks|/api/tasks|toTaskAtom" -Recurse`
Expected: no matches.

**Step 4: Commit (only if `dist/` is tracked in this repo)**

Check `git status`. If `dist/` is tracked (this repo commits compiled output — see recent commit "build: compile prompt-driven recall to dist"), commit it:
```powershell
git add dist
git commit -m "build: compile task-subsystem removal to dist"
```
If `dist/` is gitignored, skip this step.

---

### Task 9: One-time disk cleanup of orphaned task files

**Files:** none in-repo (operates on `~/.claude`)

**Step 1: Preview the task files that would be deleted**

Run:
```powershell
Get-ChildItem -Path "$env:USERPROFILE\.claude\projects","$env:USERPROFILE\.claude\nexus-atoms" -Recurse -Filter "task_*.md" -ErrorAction SilentlyContinue | Select-Object FullName
```
Expected: a list (possibly empty) of `task_*.md` files. Review it.

**Step 2: Delete them**

Run:
```powershell
Get-ChildItem -Path "$env:USERPROFILE\.claude\projects","$env:USERPROFILE\.claude\nexus-atoms" -Recurse -Filter "task_*.md" -ErrorAction SilentlyContinue | Remove-Item -Force
```
Expected: files removed. (Rationale: with the parser task mapping gone, any leftover `task_*.md` would otherwise be re-indexed as a `memory` atom.)

**Step 3: No commit** — this touches user data outside the repo, not tracked files.

---

### Task 10: Update project docs

**Files:**
- `_documents/decisions/adr-*.md` (via skill)
- `_documents/file-map.md` (via skill)

**Step 1: Record the architecture decision**

Invoke the `add-adr` skill: "Remove Nexus task subsystem — kanban owns manual work tracking, ADR/DDR own decisions, no cross-project task-tracking need. Removed 3 MCP tools, /api/tasks routes, Tasks dashboard view, task types, and task DB columns via migration v7."

**Step 2: Refresh the file map**

Invoke the `update-file-map` skill (or `/update-file-map`) to drop `src/frontend/views/Tasks.svelte` and `src/tasks.test.ts` and reflect the trimmed `nexus_remember`.

**Step 3: Commit**

```powershell
git add _documents
git commit -m "docs: ADR + file-map for task subsystem removal"
```

---

### Task 11: Finish the branch

**Step 1:** Invoke the `finish-branch` skill to merge `feat/remove-task-subsystem` back into `main`. Because this project branches in place (no worktree), `finish-branch` performs the merge only — there is no worktree to remove.

**Note:** Do NOT push to the remote unless the user explicitly asks (per project git rules). After merge, remind the user that this is a deploy-relevant change if the MCP server is running — they may need to restart it to pick up the removed tools.

---

## Post-plan: next feature

After this removal merges, the follow-up is `nexus_remember_batch` — a **separate** batch tool (not an overload of `nexus_remember`) targeting the now-simplified knowledge-only surface. That is a distinct brainstorming → plan cycle, not part of this plan.
