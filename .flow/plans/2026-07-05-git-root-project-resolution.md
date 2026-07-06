# Git-Root Project Resolution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `dispatch-agents` skill to implement this plan task-by-task.

**Goal:** Stop project memory/atoms/sessions from fragmenting across many `~/.claude/projects/<slug>` buckets for what is really one project, by resolving project identity from the git repository root (collapsing worktrees and subdirectories) instead of slugging the raw cwd string, and merge the historical fragmentation this bug already caused.

**Architecture:** A new `resolveGitProjectRoot(cwd)` in `src/core/project-root.ts` shells out to `git rev-parse --git-common-dir` to find the real repo root (this also collapses worktrees for free, since `--git-common-dir` always points at the main checkout's `.git`). Every live-cwd call site composes this with the existing `cwdToProjectSlug` via a new `resolveProjectSlug(cwd)` helper. A one-time, re-runnable `nexus migrate-projects` CLI command finds projects whose current DB `project` value doesn't match what git-root resolution of their last-known cwd would produce, merges those rows onto the canonical slug, deduplicates via the existing `consolidateMemories`, and re-exports — the already-planned `exportAll()` bucket-pruning fix then deletes the now-stale on-disk folders as a side effect, with zero separate deletion code needed.

**Tech Stack:** TypeScript/Node, better-sqlite3, `child_process.execFileSync` (git), vitest, commander CLI.

**Branch:** Already on `git-root-project-resolution` (branched in place — this repo's hooks use hardcoded paths, so no worktree per project convention). No worktree to create or remove; final task hands off to `finish-branch` directly.

---

### Task 1: `resolveGitProjectRoot` + `resolveProjectSlug` in a new shared module

**Files:**
- Create: `src/core/project-root.ts`
- Test: `src/core/project-root.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/core/project-root.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileSyncMock = vi.fn();
vi.mock('child_process', () => ({ execFileSync: (...args: unknown[]) => execFileSyncMock(...args) }));

const { resolveGitProjectRoot, resolveProjectSlug, cwdToProjectSlug } = await import('./project-root.js');

describe('resolveGitProjectRoot', () => {
  beforeEach(() => execFileSyncMock.mockReset());

  it('resolves to the cwd itself when cwd is the repo root', () => {
    execFileSyncMock.mockReturnValue('.git\n');
    expect(resolveGitProjectRoot('C:\\Fran\\Voodoo Magic')).toBe('C:\\Fran\\Voodoo Magic');
  });

  it('resolves a subdirectory up to the repo root', () => {
    execFileSyncMock.mockReturnValue('../.git\n');
    expect(resolveGitProjectRoot('C:\\Fran\\Voodoo Magic\\tools')).toBe('C:\\Fran\\Voodoo Magic');
  });

  it('collapses a worktree onto the main checkout via an absolute common-dir', () => {
    execFileSyncMock.mockReturnValue('C:\\Fran\\Voodoo Magic\\.git\n');
    expect(resolveGitProjectRoot('C:\\Fran\\Voodoo Magic\\.worktrees\\refactor-x')).toBe('C:\\Fran\\Voodoo Magic');
  });

  it('falls back to cwd when git fails or cwd is not a repo', () => {
    execFileSyncMock.mockImplementation(() => { throw new Error('fatal: not a git repository'); });
    expect(resolveGitProjectRoot('C:\\Fran\\NotARepo')).toBe('C:\\Fran\\NotARepo');
  });
});

describe('resolveProjectSlug', () => {
  beforeEach(() => execFileSyncMock.mockReset());

  it('composes git-root resolution with slugging', () => {
    execFileSyncMock.mockReturnValue('../.git\n');
    expect(resolveProjectSlug('C:\\Fran\\Voodoo Magic\\tools')).toBe('C--Fran-Voodoo-Magic');
  });

  it('falls back to plain cwd slugging when not a git repo', () => {
    execFileSyncMock.mockImplementation(() => { throw new Error('not a git repository'); });
    expect(resolveProjectSlug('C:\\Fran\\Voodoo Magic')).toBe('C--Fran-Voodoo-Magic');
  });
});

describe('cwdToProjectSlug (unchanged, moved here)', () => {
  it('converts a Windows absolute path', () => {
    expect(cwdToProjectSlug('C:\\Fran\\Monster-Hotel')).toBe('C--Fran-Monster-Hotel');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/project-root.test.ts`
Expected: FAIL — `Cannot find module './project-root.js'` (file doesn't exist yet)

**Step 3: Implement**

```typescript
// src/core/project-root.ts
import { execFileSync } from 'child_process';
import { dirname, resolve } from 'path';

/**
 * Derive the project slug from a cwd path, matching the current Claude Code
 * ~/.claude/projects/ convention: replace :, path separators, spaces, dots, and
 * underscores with '-'. ("LLM_Workflow_Optimization" → "C--Fran-LLM-Workflow-Optimization",
 * "Voodoo Magic" → "C--Fran-Voodoo-Magic", "com.x.y" → "com-x-y").
 *
 * Also collapses a literal `.worktrees`/`.claude-worktrees` path segment as a
 * defensive fallback for when git itself isn't available — resolveProjectSlug
 * below handles the general case via the actual git repo root.
 */
export function cwdToProjectSlug(cwd: string): string | null {
  const slug = cwd
    .replace(/[:\\/ ._]/g, '-')
    .replace(/-+(claude-)?worktrees?-.*$/, '')
    .replace(/^-+|-+$/g, '');
  return slug.length >= 3 ? slug : null;
}

/**
 * Resolve the canonical project root directory for a cwd via its git repository.
 * `git rev-parse --git-common-dir` always points at the *main* checkout's .git
 * directory (even from inside a worktree), so its parent is the one true project
 * root regardless of which subdirectory or worktree the caller is in. Falls back
 * to the raw cwd unchanged when git is unavailable, times out, or cwd isn't a repo
 * — callers must never block on this.
 */
export function resolveGitProjectRoot(cwd: string): string {
  try {
    const commonDir = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], {
      encoding: 'utf-8',
      timeout: 2000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!commonDir) return cwd;
    return dirname(resolve(cwd, commonDir));
  } catch {
    return cwd;
  }
}

/** Compose git-root resolution with slugging — the one function every live-cwd call site should use. */
export function resolveProjectSlug(cwd: string): string | null {
  return cwdToProjectSlug(resolveGitProjectRoot(cwd));
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/project-root.test.ts`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add src/core/project-root.ts src/core/project-root.test.ts
git commit -m "feat: add git-root-based project slug resolution"
```

---

### Task 2: Re-point `indexer.ts` at the shared module

**Files:**
- Modify: `src/indexer/indexer.ts:9-11` (imports), `src/indexer/indexer.ts:278-294` (old `cwdToProjectSlug` def), `src/indexer/indexer.ts:359` (indexCoworkSession call site)

**Step 1: Implement**

Add to the top import block (after line 11, `import { vecToBlob } from '../core/memories.js';`):

```typescript
import { resolveProjectSlug } from '../core/project-root.js';
```

Replace the entire old function block (lines 278-294 — the JSDoc comment plus `export function cwdToProjectSlug`) with a re-export, so every existing `import { cwdToProjectSlug } from '../indexer/indexer.js'` elsewhere in the codebase keeps working unchanged:

```typescript
// cwdToProjectSlug / resolveProjectSlug live in ../core/project-root.js so the
// lightweight UserPromptSubmit hook can use slug logic without pulling in the
// rest of the indexer (glob, better-sqlite3 transitively via this module).
export { cwdToProjectSlug, resolveProjectSlug } from '../core/project-root.js';
```

Update the Cowork session indexing call site (was line 359):

```typescript
    const project = userFolder ? resolveProjectSlug(userFolder) : workspaceId;
```

**Step 2: Verify**

Run: `npx vitest run src/slug.test.ts`
Expected: PASS (all existing `cwdToProjectSlug` tests still pass via re-export)

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/indexer/indexer.ts
git commit -m "refactor: re-point indexer.ts cwdToProjectSlug at core/project-root"
```

---

### Task 3: Use `resolveProjectSlug` in the MCP server's project resolver

**Files:**
- Modify: `src/mcp/server.ts:9` (import), `src/mcp/server.ts:54-74` (`resolveProjectFromCwd`)

**Step 1: Implement**

Change the import on line 9 from:
```typescript
import { runFullIndex, cwdToProjectSlug } from '../indexer/indexer.js';
```
to:
```typescript
import { runFullIndex, cwdToProjectSlug } from '../indexer/indexer.js';
import { resolveProjectSlug } from '../core/project-root.js';
```

Replace the `resolveProjectFromCwd` function body (lines 54-74):

```typescript
/**
 * Resolve a project slug from a working-directory path.
 * 1. Git-root-resolved slug via resolveProjectSlug (collapses worktrees and
 *    subdirectories onto the repo root, e.g. "C--Fran-Monster-Hotel").
 * 2. Short-name fallback (last path segment lowercased, e.g. "monster-hotel"). Handles projects
 *    whose tasks were created with a short name rather than the full path slug.
 * Each candidate is checked against atoms AND sessions so backfill resolution works too.
 */
function resolveProjectFromCwd(cwd: string): string {
  const known = (slug: string) =>
    !!db.prepare(`SELECT 1 FROM atoms    WHERE project = ? LIMIT 1`).get(slug) ||
    !!db.prepare(`SELECT 1 FROM sessions WHERE project = ? LIMIT 1`).get(slug);

  const derived = resolveProjectSlug(cwd);
  if (derived && known(derived)) return derived;

  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
  const shortName = parts[parts.length - 1]?.toLowerCase().replace(/_/g, '-');
  if (shortName && shortName !== derived?.toLowerCase() && known(shortName)) return shortName;

  return derived ?? shortName ?? cwd;
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors (note `cwdToProjectSlug` import in server.ts is now unused if nothing else in the file references it — check with a quick grep and drop it if so)

Run: `Get-ChildItem src\mcp\server.ts | Select-String "cwdToProjectSlug"` — if only the import line matches, remove `cwdToProjectSlug` from the import list, keeping just `runFullIndex`.

**Step 3: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: resolve MCP project slugs via git root"
```

---

### Task 4: Use `resolveProjectSlug` in the web API server

**Files:**
- Modify: `src/web/server.ts:16` (import), `src/web/server.ts:89`, `src/web/server.ts:107`

**Step 1: Implement**

Change line 16 from:
```typescript
import { runFullIndex, reindexFile, cwdToProjectSlug } from '../indexer/indexer.js';
```
to:
```typescript
import { runFullIndex, reindexFile } from '../indexer/indexer.js';
import { resolveProjectSlug } from '../core/project-root.js';
```

Line 89 (`/api/reflect` handler), change:
```typescript
        project: project ?? (cwd ? cwdToProjectSlug(cwd) : null),
```
to:
```typescript
        project: project ?? (cwd ? resolveProjectSlug(cwd) : null),
```

Line 107 (`/api/recall` handler), change:
```typescript
  const effectiveProject = project ?? (cwd ? cwdToProjectSlug(cwd) : null);
```
to:
```typescript
  const effectiveProject = project ?? (cwd ? resolveProjectSlug(cwd) : null);
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/web/server.ts
git commit -m "feat: resolve web API project slugs via git root"
```

---

### Task 5: Use `resolveProjectSlug` in the Stop-hook capture runner

**Files:**
- Modify: `src/capture/runner.ts:9`, `src/capture/runner.ts:25`

**Step 1: Implement**

Change line 9 from:
```typescript
import { cwdToProjectSlug } from '../indexer/indexer.js';
```
to:
```typescript
import { resolveProjectSlug } from '../core/project-root.js';
```

Change line 25 from:
```typescript
  const project = cwd ? cwdToProjectSlug(cwd) : null;
```
to:
```typescript
  const project = cwd ? resolveProjectSlug(cwd) : null;
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/capture/runner.ts
git commit -m "feat: resolve capture-runner project slugs via git root"
```

---

### Task 6: Remove the duplicated slug function in the UserPromptSubmit hook

**Files:**
- Modify: `src/capture/prompt-runner.ts:13-28` (imports + inlined function), `src/capture/prompt-runner.ts:64` (usage)

**Step 1: Implement**

Replace lines 13-28:
```typescript
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
```
with:
```typescript
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { openDatabase } from '../core/database.js';
import { recallByQuery } from '../core/recall.js';
import { getNexusConfig } from '../core/config.js';
import { resolveProjectSlug } from '../core/project-root.js';
```

Change line 64 (now shifted up ~8 lines after the deletion — locate by content, not line number) from:
```typescript
  const project = cwdToProjectSlug(payload.cwd || process.cwd()) ?? null;
```
to:
```typescript
  const project = resolveProjectSlug(payload.cwd || process.cwd()) ?? null;
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

Run: `echo '{"prompt":"does this recall still work end to end","session_id":"test-plan-verify","cwd":"C:\\Fran\\claude-nexus"}' | node --loader ts-node/esm src/capture/prompt-runner.ts`
Expected: exits 0, prints either nothing or an `additionalContext` JSON block — no stack trace

**Step 3: Commit**

```bash
git add src/capture/prompt-runner.ts
git commit -m "refactor: drop duplicated slug logic in prompt-runner, use core/project-root"
```

---

### Task 7: Add the `project_aliases` table (migration 8)

**Files:**
- Modify: `src/core/database.ts:51-59` (`MIGRATIONS` array), append new migration function near `migrateRemoveTaskSupport`

**Step 1: Implement**

Change the `MIGRATIONS` array (lines 51-59) from:
```typescript
const MIGRATIONS: Migration[] = [
  { version: 1, name: 'baseline-v1-schema', up: migrateBaseline },
  { version: 2, name: 'memories-tables', up: migrateMemories },
  { version: 3, name: 'session-reflection-cursor', up: migrateReflectionCursor },
  { version: 4, name: 'import-legacy-memory-atoms', up: migrateImportLegacyMemories },
  { version: 5, name: 'session-messages-fts', up: migrateSessionMessagesFts },
  { version: 6, name: 'corpus-expansion', up: migrateCorpusExpansion },
  { version: 7, name: 'remove-task-support', up: migrateRemoveTaskSupport },
];
```
to:
```typescript
const MIGRATIONS: Migration[] = [
  { version: 1, name: 'baseline-v1-schema', up: migrateBaseline },
  { version: 2, name: 'memories-tables', up: migrateMemories },
  { version: 3, name: 'session-reflection-cursor', up: migrateReflectionCursor },
  { version: 4, name: 'import-legacy-memory-atoms', up: migrateImportLegacyMemories },
  { version: 5, name: 'session-messages-fts', up: migrateSessionMessagesFts },
  { version: 6, name: 'corpus-expansion', up: migrateCorpusExpansion },
  { version: 7, name: 'remove-task-support', up: migrateRemoveTaskSupport },
  { version: 8, name: 'project-aliases', up: migrateProjectAliases },
];
```

Add the new migration function anywhere below the `MIGRATIONS` array (e.g. right after `migrateRemoveTaskSupport`'s closing brace):

```typescript
// ── Migration 8: project aliases ─────────────────────────────────────
// Records project slugs that were folded into a canonical slug by the
// git-root project-resolution merge (see src/capture/project-migrate.ts).

function migrateProjectAliases(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_aliases (
      alias_slug     TEXT PRIMARY KEY,
      canonical_slug TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
```

**Step 2: Verify**

Run: `npx vitest run src/core/database.test.ts`
Expected: PASS

Run: `node -e "const {openDatabase,initializeSchema}=require('./dist/core/database.js'); const db=openDatabase(':memory:'); initializeSchema(db); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name='project_aliases'\").get());"` (after `npm run build`)
Expected: prints `{ name: 'project_aliases' }`

**Step 3: Commit**

```bash
git add src/core/database.ts
git commit -m "feat: add project_aliases table (migration 8)"
```

---

### Task 8: Prune stale export buckets in `exportAll`

**Files:**
- Modify: `src/capture/export.ts:96-99` (end of `exportAll`, before `return`)
- Test: `src/capture/export.test.ts` (append)

**Step 1: Write the failing tests**

Append to `src/capture/export.test.ts`:

```typescript
  it('prunes a stale bucket directory that no longer has any live memories', () => {
    const db = freshDb();
    insertMemory(db, { ...base, project: 'live-proj', title: 'Still here', body: 'kept.', memory_type: 'convention', review_status: 'approved' });

    const dir = mkdtempSync(join(tmpdir(), 'nexus-exp-'));
    mkdirSync(join(dir, 'stale-proj', 'memory'), { recursive: true });
    writeFileSync(join(dir, 'stale-proj', 'memory', 'MEMORY.md'), '# stale');

    exportAll(db, dir);

    expect(existsSync(join(dir, 'stale-proj'))).toBe(false);
    expect(existsSync(join(dir, 'live-proj', 'memory', 'MEMORY.md'))).toBe(true);
    db.close();
  });

  it('never deletes a project directory that still holds a session .jsonl', () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'nexus-exp-'));
    mkdirSync(join(dir, 'still-active-sessions', 'memory'), { recursive: true });
    writeFileSync(join(dir, 'still-active-sessions', 'memory', 'MEMORY.md'), '# stale');
    writeFileSync(join(dir, 'still-active-sessions', 'abc123.jsonl'), '{}');

    exportAll(db, dir);

    expect(existsSync(join(dir, 'still-active-sessions', 'abc123.jsonl'))).toBe(true);
    expect(existsSync(join(dir, 'still-active-sessions', 'memory'))).toBe(false);
    db.close();
  });
```

Add `mkdirSync` to the existing import line at the top of the test file (currently `import { mkdtempSync, existsSync, readdirSync, readFileSync } from 'fs';`) → `import { mkdtempSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs';` (`writeFileSync` also needed and not yet imported).

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/capture/export.test.ts`
Expected: FAIL — both new tests fail (stale dirs still present after `exportAll`)

**Step 3: Implement**

In `src/capture/export.ts`, replace the tail of `exportAll` (currently):
```typescript
    writeFileSync(join(dir, 'MEMORY.md'), index.join('\n'));
    files++;
  }

  return { buckets: byBucket.size, files, dir: exportDir };
}
```
with:
```typescript
    writeFileSync(join(dir, 'MEMORY.md'), index.join('\n'));
    files++;
  }

  // Prune project directories whose memory/ export Nexus wrote previously but
  // which no longer correspond to any live bucket (project renamed, merged via
  // project_aliases, or the memory entirely removed). Only ever deletes the
  // memory/ subdir Nexus owns — a sibling .jsonl session file (Claude Code's
  // own data) always survives, and the parent dir is removed only once empty.
  if (existsSync(exportDir)) {
    for (const entry of readdirSync(exportDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || byBucket.has(entry.name)) continue;
      const projectDir = join(exportDir, entry.name);
      const memDir = join(projectDir, 'memory');
      if (!existsSync(memDir)) continue;

      rmSync(memDir, { recursive: true, force: true });
      if (readdirSync(projectDir).length === 0) {
        rmSync(projectDir, { recursive: true, force: true });
      }
    }
  }

  return { buckets: byBucket.size, files, dir: exportDir };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/capture/export.test.ts`
Expected: PASS (4 tests total)

**Step 5: Commit**

```bash
git add src/capture/export.ts src/capture/export.test.ts
git commit -m "fix: prune stale export buckets, not just stale files within a bucket"
```

---

### Task 9: Project-alias migration (`buildProjectAliases` / `applyProjectAliases`)

**Files:**
- Create: `src/capture/project-migrate.ts`
- Test: `src/capture/project-migrate.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/capture/project-migrate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openDatabase, initializeSchema } from '../core/database.js';
import { insertMemory } from '../core/memories.js';

const resolveProjectSlugMock = vi.fn();
vi.mock('../core/project-root.js', () => ({ resolveProjectSlug: (cwd: string) => resolveProjectSlugMock(cwd) }));

const { buildProjectAliases, applyProjectAliases, migrateProjects } = await import('./project-migrate.js');

function freshDb() {
  const db = openDatabase(':memory:');
  initializeSchema(db);
  return db;
}

function insertSession(db: ReturnType<typeof freshDb>, o: { id: string; project: string; cwd: string; lastActive: string }) {
  db.prepare(`
    INSERT INTO sessions (session_id, project, cwd, jsonl_path, status, message_count, last_active)
    VALUES (?, ?, ?, '/nonexistent.jsonl', 'dead', 5, ?)
  `).run(o.id, o.project, o.cwd, o.lastActive);
}

describe('buildProjectAliases', () => {
  beforeEach(() => resolveProjectSlugMock.mockReset());

  it('finds a project whose recorded slug does not match git-root resolution', () => {
    const db = freshDb();
    insertSession(db, { id: 's1', project: 'C--Fran-Automatic Encyclopedias', cwd: 'C:\\Fran\\Automatic Encyclopedias', lastActive: '2026-06-01' });
    resolveProjectSlugMock.mockReturnValue('C--Fran-Automatic-Encyclopedias');

    const aliases = buildProjectAliases(db);
    expect(aliases).toEqual([{ alias: 'C--Fran-Automatic Encyclopedias', canonical: 'C--Fran-Automatic-Encyclopedias' }]);
    db.close();
  });

  it('skips a project already matching its git-root resolution', () => {
    const db = freshDb();
    insertSession(db, { id: 's1', project: 'C--Fran-claude-nexus', cwd: 'C:\\Fran\\claude-nexus', lastActive: '2026-06-01' });
    resolveProjectSlugMock.mockReturnValue('C--Fran-claude-nexus');

    expect(buildProjectAliases(db)).toEqual([]);
    db.close();
  });
});

describe('applyProjectAliases', () => {
  it('merges memories, atoms, and sessions onto the canonical slug', () => {
    const db = freshDb();
    insertMemory(db, { scope: 'project', project: 'old-slug', title: 'A', body: 'body a', memory_type: 'convention', decay_class: 'stable', confidence: 0.8, review_status: 'approved', source_session_id: null, discovered_from: null, tags: [] });
    insertSession(db, { id: 's1', project: 'old-slug', cwd: 'x', lastActive: '2026-06-01' });

    const report = applyProjectAliases(db, [{ alias: 'old-slug', canonical: 'new-slug' }], false);

    expect(report.memoriesUpdated).toBe(1);
    expect(report.sessionsUpdated).toBe(1);
    expect((db.prepare(`SELECT project FROM memories`).get() as { project: string }).project).toBe('new-slug');
    db.close();
  });

  it('does nothing in dry-run mode', () => {
    const db = freshDb();
    insertSession(db, { id: 's1', project: 'old-slug', cwd: 'x', lastActive: '2026-06-01' });
    const report = applyProjectAliases(db, [{ alias: 'old-slug', canonical: 'new-slug' }], true);
    expect(report.sessionsUpdated).toBe(0);
    expect((db.prepare(`SELECT project FROM sessions`).get() as { project: string }).project).toBe('old-slug');
    db.close();
  });
});

describe('migrateProjects', () => {
  beforeEach(() => resolveProjectSlugMock.mockReset());

  it('applies aliases and calls the injected consolidate + export dependencies', async () => {
    const db = freshDb();
    insertSession(db, { id: 's1', project: 'old-slug', cwd: 'C:\\x', lastActive: '2026-06-01' });
    insertMemory(db, { scope: 'project', project: 'old-slug', title: 'A', body: 'body a', memory_type: 'convention', decay_class: 'stable', confidence: 0.8, review_status: 'approved', source_session_id: null, discovered_from: null, tags: [] });
    resolveProjectSlugMock.mockReturnValue('new-slug');

    const consolidate = vi.fn().mockResolvedValue({ embedded: 0, merged: 2, pruned: 0 });
    const exportFn = vi.fn().mockReturnValue({ buckets: 1, files: 1, dir: '/x' });

    const report = await migrateProjects(db, { dryRun: false, projectsDir: '/does/not/exist' }, { consolidate, exportAll: exportFn });

    expect(report.aliases).toEqual([{ alias: 'old-slug', canonical: 'new-slug' }]);
    expect(consolidate).toHaveBeenCalledOnce();
    expect(exportFn).toHaveBeenCalledOnce();
    expect(report.merged).toBe(2);
    db.close();
  });

  it('dry run finds aliases but calls neither dependency', async () => {
    const db = freshDb();
    insertSession(db, { id: 's1', project: 'old-slug', cwd: 'C:\\x', lastActive: '2026-06-01' });
    resolveProjectSlugMock.mockReturnValue('new-slug');

    const consolidate = vi.fn();
    const exportFn = vi.fn();
    const report = await migrateProjects(db, { dryRun: true, projectsDir: '/does/not/exist' }, { consolidate, exportAll: exportFn });

    expect(report.aliases.length).toBe(1);
    expect(consolidate).not.toHaveBeenCalled();
    expect(exportFn).not.toHaveBeenCalled();
    db.close();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/capture/project-migrate.test.ts`
Expected: FAIL — `Cannot find module './project-migrate.js'`

**Step 3: Implement**

```typescript
// src/capture/project-migrate.ts
/**
 * Project-alias migration — one-time (and safely re-runnable) merge of project
 * buckets that fragmented before git-root-based resolution existed: pre-2026-06-28
 * slug bugs (space/dot/worktree suffixes never collapsed) and subdirectories of
 * the same git repo that were treated as separate projects.
 *
 * Builds aliases from each project's most-recently-active session cwd, resolved
 * through the same git-aware logic the live capture path now uses (resolveProjectSlug).
 * If that resolves to a slug different from the one already on record, every row
 * under the old slug is folded onto the canonical one. Stale on-disk export
 * directories are cleaned up as a side effect of the exportAll() call at the end
 * (see its bucket-pruning fix) — no separate deletion code needed here.
 */

import Database from 'better-sqlite3';
import { resolveProjectSlug } from '../core/project-root.js';
import { consolidateMemories, type ConsolidateResult } from '../core/consolidate.js';
import { exportAll, type ExportResult } from './export.js';
import { getClaudeConfig } from '../core/config.js';

export interface ProjectAlias {
  alias: string;
  canonical: string;
}

export interface MigrateReport {
  aliases: ProjectAlias[];
  memoriesUpdated: number;
  atomsUpdated: number;
  sessionsUpdated: number;
  merged: number;
  dryRun: boolean;
}

export interface MigrateProjectsOptions {
  dryRun: boolean;
  projectsDir?: string;
}

export interface MigrateProjectsDeps {
  consolidate?: (db: Database.Database) => Promise<ConsolidateResult>;
  exportAll?: (db: Database.Database, exportDirOverride?: string) => ExportResult;
}

/** Find every project whose most-recently-active session cwd resolves to a different slug. */
export function buildProjectAliases(db: Database.Database): ProjectAlias[] {
  const rows = db.prepare(`
    SELECT project, cwd FROM sessions s
    WHERE cwd IS NOT NULL AND cwd != '' AND project IS NOT NULL
      AND last_active = (SELECT MAX(last_active) FROM sessions s2 WHERE s2.project = s.project)
    GROUP BY project
  `).all() as { project: string; cwd: string }[];

  const aliases: ProjectAlias[] = [];
  for (const row of rows) {
    const canonical = resolveProjectSlug(row.cwd);
    if (canonical && canonical !== row.project) {
      aliases.push({ alias: row.project, canonical });
    }
  }
  return aliases;
}

/** Merge every alias's rows onto its canonical slug across memories/atoms/sessions. Records each alias in project_aliases. No-op in dry-run mode. */
export function applyProjectAliases(db: Database.Database, aliases: ProjectAlias[], dryRun: boolean): MigrateReport {
  const report: MigrateReport = {
    aliases, memoriesUpdated: 0, atomsUpdated: 0, sessionsUpdated: 0, merged: 0, dryRun,
  };
  if (dryRun || aliases.length === 0) return report;

  const recordAlias = db.prepare(
    `INSERT OR REPLACE INTO project_aliases (alias_slug, canonical_slug) VALUES (?, ?)`
  );
  const updateMemories = db.prepare(`UPDATE memories SET project = ? WHERE project = ?`);
  const updateAtoms = db.prepare(`UPDATE atoms SET project = ? WHERE project = ?`);
  const updateSessions = db.prepare(`UPDATE sessions SET project = ? WHERE project = ?`);

  db.transaction(() => {
    for (const { alias, canonical } of aliases) {
      recordAlias.run(alias, canonical);
      report.memoriesUpdated += updateMemories.run(canonical, alias).changes;
      report.atomsUpdated += updateAtoms.run(canonical, alias).changes;
      report.sessionsUpdated += updateSessions.run(canonical, alias).changes;
    }
  })();

  return report;
}

/** Full orchestration: build aliases, merge, dedup any collisions the merge created, re-export. */
export async function migrateProjects(
  db: Database.Database,
  opts: MigrateProjectsOptions,
  deps?: MigrateProjectsDeps
): Promise<MigrateReport> {
  const aliases = buildProjectAliases(db);
  const report = applyProjectAliases(db, aliases, opts.dryRun);
  if (opts.dryRun) return report;

  if (report.memoriesUpdated > 0) {
    const consolidate = deps?.consolidate ?? consolidateMemories;
    const { merged } = await consolidate(db);
    report.merged = merged;

    const doExport = deps?.exportAll ?? exportAll;
    doExport(db);
  }

  return report;
}
```

Note: `opts.projectsDir` is accepted for interface symmetry/future use but unused today — `exportAll`'s own pruning fix (Task 8) already handles on-disk cleanup by reading `getNexusConfig().capture.export_dir` internally. Remove the unused `getClaudeConfig` import if `tsc --noEmit` flags it as unused.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/capture/project-migrate.test.ts`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add src/capture/project-migrate.ts src/capture/project-migrate.test.ts
git commit -m "feat: add project-alias migration (merge + dedup + re-export)"
```

---

### Task 10: `nexus migrate-projects` CLI command

**Files:**
- Modify: `src/cli/index.ts` (add import near top, add command block before `program.parse();`)

**Step 1: Implement**

Add near the other imports at the top of `src/cli/index.ts`:
```typescript
import { migrateProjects } from '../capture/project-migrate.js';
```

Add before the final `program.parse();` line, following the `prune-narration` command's dry-run/--apply pattern:

```typescript
// ── nexus migrate-projects ──────────────────────────────────────────

program
  .command('migrate-projects')
  .description('Merge project buckets fragmented by pre-fix slug bugs or subdirectory-per-project sessions, via git-root resolution')
  .option('--apply', 'Actually merge rows and clean up stale export directories (default is a dry-run)')
  .action(async (opts) => {
    const db = openDatabase();
    initializeSchema(db);

    const report = await migrateProjects(db, { dryRun: !opts.apply });

    if (report.aliases.length === 0) {
      console.log(chalk.green('No fragmented projects found — nothing to merge.'));
      db.close();
      return;
    }

    console.log(chalk.blue(`${report.aliases.length} project(s) would merge:\n`));
    for (const { alias, canonical } of report.aliases) {
      console.log(`  ${chalk.red(alias)} -> ${chalk.green(canonical)}`);
    }

    if (!opts.apply) {
      console.log(chalk.yellow('\nDry-run — re-run with --apply to merge and clean up stale export directories.'));
      db.close();
      return;
    }

    console.log(chalk.green(`\nMerged: ${report.memoriesUpdated} memories, ${report.atomsUpdated} atoms, ${report.sessionsUpdated} sessions.`));
    console.log(`Deduplicated ${report.merged} near-identical memory pair(s) created by the merge.`);
    db.close();
  });

program.parse();
```

(Replace the existing bare `program.parse();` at the end of the file with the block above — the new command registration must come before that call.)

**Step 2: Verify**

Run: `npm run build`
Expected: compiles with no errors

Run: `node dist/cli/index.js migrate-projects`
Expected: prints either "No fragmented projects found" or a list of `alias -> canonical` pairs, ending with the dry-run notice — no stack trace

**Step 3: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: add nexus migrate-projects CLI command"
```

---

### Task 11: Full test suite + typecheck

**Step 1: Run**

Run: `npm run build`
Expected: 0 errors

Run: `npm test`
Expected: all tests pass, including the 4 existing `src/slug.test.ts` `cwdToProjectSlug` tests (now passing through the re-export) and every new test file added above

**Step 2: Commit**

No commit — verification only. If anything fails, fix and re-run before moving on.

---

### Task 12: Run the real migration against production data

**This task touches the live `~/.claude/memories/nexus.db` and `~/.claude/projects/` — not a throwaway test fixture. Confirm with the user before running `--apply`.**

**Step 1: Back up the live database**

Run: `Copy-Item "$env:USERPROFILE\.claude\memories\nexus.db" "$env:USERPROFILE\.claude\memories\nexus.db.bak-2026-07-05"`
Expected: file copy succeeds, no output

**Step 2: Dry run against production**

Run: `node dist/cli/index.js migrate-projects`
Expected: prints the real list of `alias -> canonical` project merges Nexus would perform — review this output with the user before proceeding

**Step 3: Apply (only after user confirms the dry-run list looks correct)**

Run: `node dist/cli/index.js migrate-projects --apply`
Expected: prints merged counts, e.g. `Merged: N memories, M atoms, K sessions.` followed by a dedup count

**Step 4: Spot-check the on-disk cleanup**

Run: `Get-ChildItem "$env:USERPROFILE\.claude\projects" -Directory | Where-Object { $_.Name -match ' ' }`
Expected: the previously-found space-preserved duplicate folders (e.g. `C--Fran-Automatic Encyclopedias`) no longer appear, since `exportAll()` (called by the migration) pruned their now-orphaned `memory/` directories and removed the now-empty parent dirs

**Step 5: No commit** — this task only mutates the live DB/filesystem outside the repo, nothing to commit.

---

### Task 13: Hand off to `finish-branch`

All tasks above are committed on `git-root-project-resolution`. Invoke the `finish-branch` skill to review the branch, run final checks, and offer merge/PR/keep/discard options back into `main`. No worktree exists for this branch (branched in place per this repo's convention), so `finish-branch` only needs to handle the branch itself — nothing to clean up on the filesystem side.
