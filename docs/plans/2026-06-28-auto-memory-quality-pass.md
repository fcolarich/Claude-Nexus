# Auto-Memory Quality Pass Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `dispatch-agents` skill to implement this plan task-by-task.

**Goal:** Stop the capture pipeline from creating low-value memories (session-completion narration, `handoff` state, ADR/DDR-duplicate decisions) and sweep the existing ones out of the DB across all projects.

**Architecture:** Capture has an Observer gate that decides *whether* to call Haiku, but nothing filters Haiku's output. We add: (a) `handoff` removed from extractable types; (b) a hardened extraction prompt; (c) a pure `refineCandidates()` post-filter that drops completion narration and converts ADR/DDR-citing decisions into thin reference pointers; (d) `readDecisionIndex(cwd)` so the extractor knows which decisions are already canonical; (e) a DB-wide `nexus prune-narration` CLI sweep that hard-deletes existing offenders and re-exports the markdown mirror.

**Tech Stack:** TypeScript (ESM, Node 22+), better-sqlite3, commander, chalk, Vitest. Tabs for indentation.

---

## Notes for the executor

- **Indentation is TABS**, not spaces. Match surrounding code.
- All paths are relative to repo root `C:\Fran\claude-nexus`.
- Build with `npm run build` (tsc → dist/); tests with `npx vitest run <file>`.
- This runs on a dedicated worktree; the final task hands off to `finish-branch`.

---

### Task 1: Drop `handoff` from extractable types + harden the extraction prompt

**Files:**
- Modify: `src/capture/extract.ts` (the `MEMORY_TYPES` set line 25, and `SYSTEM_PROMPT` lines 30-70)

**Step 1: Remove `handoff` from the validation set**

Replace line 25:

```ts
const MEMORY_TYPES = new Set<string>(['preference', 'convention', 'failure', 'correction', 'decision', 'insight', 'tool_quirk', 'reference']);
```

(Leave `MemoryType` in `src/core/types.ts` unchanged — surviving rows must still display/recall; we only stop creating new handoffs.)

**Step 2: Update the prompt — remove the handoff type line and add two rules**

In `SYSTEM_PROMPT`, delete this line from the memory_type list:

```
- handoff     — end-of-session state: what was done and what comes next
```

Then, in the `Rules:` block, add these two bullets after the existing "Do NOT extract content that appears to be a memory index" bullet:

```
- Do NOT extract session-progress or completion narration. An announcement that the session DID something is not durable knowledge. Reject anything of the form "X initialized", "Y completed", "scaffold complete", "doc spine initialized", "knowledge extraction completed", "folder now indexed", "now available", "setup complete". These describe work performed, not a reusable fact.
- If a decision is ALREADY recorded as an ADR or DDR (see the "Existing canonical decisions" list in the user message, or if the transcript cites an ADR-NNN / DDR-NNN id), do NOT restate it. Emit a "reference" memory instead: title = the decision name, body = a one-line gist followed by "→ ADR-NNN". The ADR/DDR file is the source of truth; the memory only aids retrieval.
```

**Step 3: Verify it compiles**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors.

**Step 4: Commit**

```bash
git add src/capture/extract.ts
git commit -m "feat(capture): drop handoff type, harden extraction prompt against narration"
```

---

### Task 2: Add the pure `refineCandidates()` post-filter

**Files:**
- Modify: `src/capture/extract.ts`
- Test: `src/capture/extract.test.ts` (create)

This task has branching logic and a contract the reflector depends on → **test-warranted**.

**Step 1: Write the failing test**

Create `src/capture/extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCandidates, refineCandidates, type MemoryCandidate } from './extract.js';

function cand(overrides: Partial<MemoryCandidate>): MemoryCandidate {
	return {
		title: 'Some durable fact',
		body: 'A reusable rule about the system and why it matters.',
		memory_type: 'insight',
		scope: 'project',
		decay_class: 'implementation',
		confidence: 0.8,
		tags: ['a'],
		...overrides,
	};
}

describe('parseCandidates', () => {
	it('rejects handoff memory_type', () => {
		const raw = JSON.stringify([
			{ title: 'Doc spine done', body: 'Scaffold created.', memory_type: 'handoff', scope: 'project', decay_class: 'implementation', confidence: 0.9, tags: [] },
		]);
		expect(parseCandidates(raw)).toHaveLength(0);
	});
});

describe('refineCandidates', () => {
	it('drops completion / progress narration by title', () => {
		const c = cand({ title: 'Rumble Editor Tools doc spine initialized', memory_type: 'reference' });
		expect(refineCandidates([c])).toHaveLength(0);
	});

	it('drops completion narration by body', () => {
		const c = cand({ title: 'Assets folder', body: "Assets/ folder is now indexed for semantic search.", memory_type: 'reference' });
		expect(refineCandidates([c])).toHaveLength(0);
	});

	it('converts an ADR-citing decision into a reference pointer', () => {
		const c = cand({
			title: 'UPM package-per-tool baseline',
			body: 'Uses a UPM package-per-tool architecture. Codified in ADR-001 and DDR-001.',
			memory_type: 'decision',
		});
		const out = refineCandidates([c]);
		expect(out).toHaveLength(1);
		expect(out[0].memory_type).toBe('reference');
		expect(out[0].body).toContain('ADR-001');
		// the restated content is collapsed to a short pointer, not the full body
		expect(out[0].body.length).toBeLessThan(c.body.length + 10);
	});

	it('leaves a clean decision untouched', () => {
		const c = cand({ title: 'Odin soft dependency', body: 'Odin is a hard dependency only for some packages, not all.', memory_type: 'decision' });
		const out = refineCandidates([c]);
		expect(out).toHaveLength(1);
		expect(out[0].memory_type).toBe('decision');
	});
});
```

**Step 2: Run it to confirm it fails**

Run: `npx vitest run src/capture/extract.test.ts`
Expected: FAIL — `refineCandidates` is not exported.

**Step 3: Implement `refineCandidates` and wire it into `extractMemories`**

In `src/capture/extract.ts`, add the shared regexes near the top (after the `MAX_CANDIDATES` const, ~line 28). These are `export`ed because the prune sweep (Task 5) reuses them:

```ts
/** Completion / session-progress narration — never durable knowledge. */
export const COMPLETION_RE = /\b(initialized|scaffold(ed)?\s+complete|spine\s+(complete|initialized)|doc\s+spine|knowledge\s+extraction|extraction\s+complete|now\s+(indexed|available)|indexed\s+(for|in)|setup\s+complete)\b/i;

/** A cited Architecture/Design Decision Record id. */
export const ADR_REF_RE = /\b(ADR|DDR)-\d+/i;
```

Add the `refineCandidates` function (place it after `parseCandidates`, before `extractMemories`):

```ts
/**
 * Deterministic quality filter applied to extracted candidates.
 * - Drops completion / progress narration.
 * - Converts an ADR/DDR-citing `decision` into a thin `reference` pointer so the
 *   ADR stays canonical and the memory only aids retrieval (no content drift).
 */
export function refineCandidates(cands: MemoryCandidate[]): MemoryCandidate[] {
	const out: MemoryCandidate[] = [];
	for (const c of cands) {
		if (COMPLETION_RE.test(c.title) || COMPLETION_RE.test(c.body)) continue;

		if (c.memory_type === 'decision' && ADR_REF_RE.test(c.body)) {
			const ref = (c.body.match(ADR_REF_RE) ?? [])[0]?.toUpperCase() ?? '';
			const firstSentence = c.body.split(/(?<=[.!?])\s/)[0].trim();
			const body = ref && !firstSentence.includes(ref) ? `${firstSentence} → ${ref}` : firstSentence;
			out.push({ ...c, memory_type: 'reference', decay_class: 'architecture', body });
			continue;
		}

		out.push(c);
	}
	return out;
}
```

Then change `extractMemories` to run the refinement (line ~114):

```ts
	const raw = await callModel(SYSTEM_PROMPT, userPrompt);
	return refineCandidates(parseCandidates(raw));
```

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/capture/extract.test.ts`
Expected: PASS (all cases green).

**Step 5: Commit**

```bash
git add src/capture/extract.ts src/capture/extract.test.ts
git commit -m "feat(capture): add refineCandidates filter (drop narration, ADR/DDR pointers)"
```

---

### Task 3: Add `readDecisionIndex(cwd)` doc-spine reader

**Files:**
- Create: `src/capture/docspine.ts`
- Test: `src/capture/docspine.test.ts`

Parsing + fs edge cases → **test-warranted**.

**Step 1: Write the failing test**

Create `src/capture/docspine.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readDecisionIndex } from './docspine.js';

let root: string;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), 'nexus-docspine-'));
	const dir = join(root, '_documents', 'decisions');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'adr-001-upm-package-per-tool.md'), '---\ntitle: foo\n---\n\n# UPM package-per-tool baseline\n\nbody');
	writeFileSync(join(dir, 'ddr-001-naming.md'), '# Naming convention\n\nbody');
	writeFileSync(join(dir, 'README.md'), '# not a decision');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('readDecisionIndex', () => {
	it('lists adr/ddr titles with ids', () => {
		const out = readDecisionIndex(root);
		expect(out).toContain('ADR-001: UPM package-per-tool baseline');
		expect(out).toContain('DDR-001: Naming convention');
		expect(out.some(l => l.includes('README'))).toBe(false);
	});

	it('returns [] for a missing spine', () => {
		expect(readDecisionIndex(join(root, 'nope'))).toEqual([]);
	});

	it('returns [] for undefined cwd', () => {
		expect(readDecisionIndex(undefined)).toEqual([]);
	});
});
```

**Step 2: Run it to confirm it fails**

Run: `npx vitest run src/capture/docspine.test.ts`
Expected: FAIL — module `./docspine.js` not found.

**Step 3: Implement `src/capture/docspine.ts`**

```ts
/**
 * Doc-spine reader — surfaces a project's existing ADR/DDR decisions so the
 * extractor can prefer thin pointers over restating canonical decisions.
 * Any filesystem error degrades to [] — a missing spine is the normal case.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const DECISION_FILE_RE = /^(adr|ddr)-\d+.*\.md$/i;

/** e.g. ["ADR-001: UPM package-per-tool baseline", "DDR-001: Naming convention"]. */
export function readDecisionIndex(cwd: string | undefined): string[] {
	if (!cwd) return [];
	try {
		const dir = join(cwd, '_documents', 'decisions');
		if (!existsSync(dir)) return [];
		const out: string[] = [];
		for (const f of readdirSync(dir).sort()) {
			if (!DECISION_FILE_RE.test(f)) continue;
			const id = f.replace(/\.md$/i, '').split('-').slice(0, 2).join('-').toUpperCase(); // ADR-001
			let title = '';
			try {
				const text = readFileSync(join(dir, f), 'utf-8');
				const m = text.match(/^#\s+(.+)$/m);
				title = m ? m[1].trim() : '';
			} catch { /* unreadable file — keep the id alone */ }
			out.push(title ? `${id}: ${title}` : id);
		}
		return out;
	} catch {
		return [];
	}
}
```

Note: the title is taken from the first markdown `# Heading`, not the frontmatter `title:` (per the project's ADR convention, the body opens with the real decision name; the frontmatter `title` may be a placeholder).

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/capture/docspine.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/capture/docspine.ts src/capture/docspine.test.ts
git commit -m "feat(capture): add readDecisionIndex doc-spine reader"
```

---

### Task 4: Wire the doc-spine list into the extractor

**Files:**
- Modify: `src/capture/extract.ts` (the `Extractor` type ~line 23, and `extractMemories` ~line 110-114)
- Modify: `src/capture/reflector.ts` (~line 85)

Glue/wiring → **default variant (no new test)**; covered by existing reflector tests + the Task 2/3 unit tests.

**Step 1: Extend the extractor context to accept `decisions`**

In `src/capture/extract.ts`, change the `Extractor` type (line 23):

```ts
export type Extractor = (condensed: string, ctx: { project: string | null; decisions?: string[] }) => Promise<MemoryCandidate[]>;
```

Change `extractMemories`'s signature and prompt assembly (lines 110-113):

```ts
export async function extractMemories(condensed: string, ctx: { project: string | null; decisions?: string[] }): Promise<MemoryCandidate[]> {
	if (!condensed.trim()) return [];
	const decisionsBlock = ctx.decisions && ctx.decisions.length
		? `\n\nExisting canonical decisions (already recorded as ADR/DDR — do NOT restate these; emit a reference pointer if relevant):\n${ctx.decisions.map(d => `- ${d}`).join('\n')}`
		: '';
	const userPrompt = `Project: ${ctx.project ?? '(none)'}${decisionsBlock}\n\nTranscript:\n${condensed}\n\nExtract the durable memories as a JSON array.`;
	const raw = await callModel(SYSTEM_PROMPT, userPrompt);
	return refineCandidates(parseCandidates(raw));
}
```

**Step 2: Pass the doc-spine list from the reflector**

In `src/capture/reflector.ts`, add the import near the other capture imports (~line 21):

```ts
import { readDecisionIndex } from './docspine.js';
```

Change the extract call (line 85):

```ts
	const decisions = readDecisionIndex(opts.cwd);
	const candidates = await extract(window.text, { project: opts.project, decisions });
```

**Step 3: Verify build + existing reflector tests still pass**

Run: `npm run build && npx vitest run`
Expected: build clean; all existing tests pass (the injected fake extractor in reflector tests ignores `decisions`, which is optional).

**Step 4: Commit**

```bash
git add src/capture/extract.ts src/capture/reflector.ts
git commit -m "feat(capture): feed doc-spine decisions into the extractor"
```

---

### Task 5: Add `deleteMemory` + `selectNarrationMemories` selection

**Files:**
- Modify: `src/core/memories.ts` (add `deleteMemory`)
- Create: `src/capture/prune.ts`
- Test: `src/capture/prune.test.ts`

Selection logic over DB rows → **test-warranted**.

**Step 1: Write the failing test**

Create `src/capture/prune.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../core/database.js';
import { insertMemory, deleteMemory } from '../core/memories.js';
import { selectNarrationMemories } from './prune.js';

function seed(db: Database.Database) {
	const base = { scope: 'project' as const, project: 'p', confidence: 0.9, review_status: 'approved' as const, source_session_id: 's', discovered_from: null, tags: [] as string[] };
	insertMemory(db, { ...base, title: 'Odin soft dependency', body: 'Odin is a hard dependency only for some packages.', memory_type: 'decision', decay_class: 'architecture' });
	insertMemory(db, { ...base, title: 'Doc spine initialized', body: 'Scaffold complete for the project.', memory_type: 'handoff', decay_class: 'implementation' });
	insertMemory(db, { ...base, title: 'Vinspector knowledge extraction completed', body: 'Extracted patterns from the plugin.', memory_type: 'reference', decay_class: 'implementation' });
	insertMemory(db, { ...base, title: 'UPM package-per-tool', body: 'Uses package-per-tool. Codified in ADR-001 and DDR-001.', memory_type: 'decision', decay_class: 'architecture' });
}

describe('selectNarrationMemories', () => {
	let db: Database.Database;
	beforeEach(() => { db = new Database(':memory:'); initializeSchema(db); seed(db); });

	it('selects handoffs, completion narration, and ADR/DDR-duplicate decisions', () => {
		const victims = selectNarrationMemories(db);
		const reasons = victims.map(v => v.reason).sort();
		expect(reasons).toEqual(['adr-ddr-duplicate', 'completion-narration', 'handoff']);
	});

	it('does not select the clean Odin decision', () => {
		const victims = selectNarrationMemories(db);
		expect(victims.some(v => v.title.includes('Odin'))).toBe(false);
	});

	it('deleteMemory removes the row', () => {
		const victims = selectNarrationMemories(db);
		for (const v of victims) expect(deleteMemory(db, v.id)).toBe(true);
		expect(selectNarrationMemories(db)).toHaveLength(0);
	});
});
```

**Step 2: Run it to confirm it fails**

Run: `npx vitest run src/capture/prune.test.ts`
Expected: FAIL — `selectNarrationMemories` / `deleteMemory` not found.

**Step 3: Add `deleteMemory` to `src/core/memories.ts`**

Add after `touchMemory` (~line 124):

```ts
/** Hard-delete a memory and its vector row. Returns false if the id was absent. */
export function deleteMemory(db: Database.Database, id: string): boolean {
	const row = db.prepare(`SELECT rowid FROM memories WHERE id = ?`).get(id) as { rowid: number } | undefined;
	if (!row) return false;
	try { db.prepare(`DELETE FROM memories_vec WHERE rowid = ?`).run(row.rowid); } catch { /* vec table absent */ }
	db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
	return true;
}
```

**Step 4: Create `src/capture/prune.ts`**

```ts
/**
 * One-time sweep: identify low-value auto-captured memories — handoffs,
 * completion/progress narration, and ADR/DDR-duplicate decisions — across
 * every project. The CLI (`nexus prune-narration`) hard-deletes them.
 */

import Database from 'better-sqlite3';
import { COMPLETION_RE, ADR_REF_RE } from './extract.js';

export interface PruneCandidate {
	id: string;
	title: string;
	memory_type: string;
	reason: 'handoff' | 'completion-narration' | 'adr-ddr-duplicate';
}

export function selectNarrationMemories(db: Database.Database): PruneCandidate[] {
	const rows = db.prepare(`SELECT id, title, body, memory_type FROM memories`).all() as
		{ id: string; title: string; body: string; memory_type: string }[];
	const out: PruneCandidate[] = [];
	for (const r of rows) {
		const base = { id: r.id, title: r.title, memory_type: r.memory_type };
		if (r.memory_type === 'handoff') { out.push({ ...base, reason: 'handoff' }); continue; }
		if (COMPLETION_RE.test(r.title) || COMPLETION_RE.test(r.body)) { out.push({ ...base, reason: 'completion-narration' }); continue; }
		if (r.memory_type === 'decision' && ADR_REF_RE.test(r.body)) { out.push({ ...base, reason: 'adr-ddr-duplicate' }); continue; }
	}
	return out;
}
```

**Step 5: Run the test to confirm it passes**

Run: `npx vitest run src/capture/prune.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
git add src/core/memories.ts src/capture/prune.ts src/capture/prune.test.ts
git commit -m "feat(capture): add deleteMemory + selectNarrationMemories sweep selection"
```

---

### Task 6: Add the `nexus prune-narration` CLI command

**Files:**
- Modify: `src/cli/index.ts` (add imports + a new command before `program.parse()` line 324)

CLI glue → **default variant**; the selection logic is already tested in Task 5.

**Step 1: Add imports**

At the top of `src/cli/index.ts`, after the existing capture import (line 7), add:

```ts
import { deleteMemory } from '../core/memories.js';
import { selectNarrationMemories } from '../capture/prune.js';
import { exportAll } from '../capture/export.js';
```

**Step 2: Add the command (insert before `program.parse();` at line 324)**

```ts
// ── nexus prune-narration ────────────────────────────────────────────

program
	.command('prune-narration')
	.description('Remove low-value memories (handoffs, completion narration, ADR/DDR-duplicate decisions) across all projects')
	.option('--apply', 'Actually delete (default is a dry-run)')
	.action((opts) => {
		const db = openDatabase();
		initializeSchema(db);

		const victims = selectNarrationMemories(db);
		if (victims.length === 0) {
			console.log(chalk.green('No narration memories found.'));
			db.close();
			return;
		}

		const reasonColors: Record<string, (s: string) => string> = {
			'handoff': chalk.magenta,
			'completion-narration': chalk.yellow,
			'adr-ddr-duplicate': chalk.cyan,
		};
		for (const v of victims) {
			const tag = (reasonColors[v.reason] ?? chalk.white)(`[${v.reason}]`);
			console.log(`${tag} ${chalk.gray(`(${v.memory_type})`)} ${v.title}`);
		}

		const counts = victims.reduce((acc, v) => { acc[v.reason] = (acc[v.reason] ?? 0) + 1; return acc; }, {} as Record<string, number>);
		console.log(chalk.blue(`\n${victims.length} memories matched: ${Object.entries(counts).map(([r, n]) => `${n} ${r}`).join(', ')}`));

		if (!opts.apply) {
			console.log(chalk.yellow('Dry-run — re-run with --apply to hard-delete.'));
			db.close();
			return;
		}

		let deleted = 0;
		for (const v of victims) if (deleteMemory(db, v.id)) deleted++;
		const exp = exportAll(db);
		console.log(chalk.green(`Deleted ${deleted} memories; re-exported ${exp.files} files across ${exp.buckets} project bucket(s).`));
		db.close();
	});
```

**Step 3: Verify the command builds and dry-runs**

Run: `npm run build && node dist/cli/index.js prune-narration`
Expected: lists the matched memories grouped by reason, then `Dry-run — re-run with --apply to hard-delete.` Nothing is deleted. (Confirm the ~10+ `*-knowledge-extraction-completed` RumbleEditorTools entries and the 3 flagged ones from session `dedfc61c` appear; confirm the `Odin soft dependency` memory does NOT.)

**Step 4: Commit**

```bash
git add src/cli/index.js src/cli/index.ts
git commit -m "feat(cli): add nexus prune-narration sweep command"
```

---

### Task 7: Run the sweep for real

**Files:** none (operational).

**Step 1: Apply the sweep**

Run: `node dist/cli/index.js prune-narration --apply`
Expected: `Deleted N memories; re-exported M files across K project bucket(s).` where N matches the dry-run count.

**Step 2: Verify the offenders are gone and the mirror is reconciled**

Run: `node dist/cli/index.js prune-narration`
Expected: `No narration memories found.`

Spot-check the markdown mirror was regenerated: confirm `C:\Users\Fran\.claude\projects\C--Fran-RumbleEditorTools\memory\3e53f3e0da47f47e-rumble-editor-tools-doc-spine-initialized.md` no longer exists and `MEMORY.md` in that folder no longer lists it.

**Step 3: Commit (no code; operational marker only — skip if nothing changed in the repo)**

No repo files change here (the DB and the user's `~/.claude` mirror are outside the repo). No commit needed.

---

### Task 8: Full build + test gate, then finish the branch

**Step 1: Full verification**

Run: `npm run build && npx vitest run`
Expected: build clean; all test files green (`extract.test.ts`, `docspine.test.ts`, `prune.test.ts`, plus existing suites).

**Step 2: Hand off to finish-branch**

Invoke the `finish-branch` skill to merge the worktree back to `main` and remove it.

---

## Out of scope (explicitly not doing)

- No config flags — none of this needs runtime tuning (flat-codebase ethos).
- No change to the Observer gate or recall ranking.
- `handoff` stays in the `MemoryType` union — only removed from the *extractable* set.
- Existing ADR/DDR-duplicate decisions are **deleted**, not converted to pointers. The pointer-not-copy policy governs *future* captures via `refineCandidates`; converting historical rows in a one-shot script isn't worth the complexity.
