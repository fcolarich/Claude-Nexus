# Origin-Based Capture Exclusion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `dispatch-agents` skill to implement this plan task-by-task.

**Goal:** Stop Claude Nexus capturing memories from book/article-processing sessions, distill-audit sessions, and the contents of files read during ordinary work.

**Architecture:** One origin classifier (`src/capture/origin.ts`) decides *whether* a session may capture at all, consulted from a single choke point inside `reflect()` and reused by a retroactive purge script so live and historical rules cannot drift. Separately, `src/capture/transcript.ts` scrubs successful content-tool result bodies out of the raw JSONL window, which covers both the VCC compaction path and the condensed-text fallback. Tool *errors* keep their bodies — they are where the genuinely useful `tool_quirk` memories come from.

**Tech Stack:** TypeScript (ESM, Node 22+), tsc → dist/, Vitest, better-sqlite3, YAML config.

**Critical context for the implementer:**
- Indentation is **tabs** in this repo (see CLAUDE.md conventions). Match surrounding style in each file.
- `reflect()` has **two** callers — `src/capture/runner.ts` (hook) and `src/web/server.ts` (REST). The gate goes *inside* `reflect()` so both are covered by one change.
- `reflect()` already runs VCC (`vcc.compactWindowLines(window.rawLines)`) at `src/capture/reflector.ts:92` and uses its output as extraction text. Filtering only `window.text` would be dead code on the normal path. **Scrub `rawLines`.**
- Transcript `.jsonl` files are JSON-encoded, so markers appear with **escaped quotes**: `<scheduled-task name=\"nexus-memory-distill\"`. Regexes must tolerate the backslash.

**Start:** create a dedicated worktree via the `git-worktrees` skill before Task 0. **End:** Task 9 hands off to `finish-branch`; Task 10 updates docs.

**Verification note:** use `npm run build` (tsc with the project tsconfig) as the compile gate. A bare `npx tsc --noEmit` additionally reports pre-existing type errors inside `node_modules/@anthropic-ai/claude-agent-sdk` that are unrelated to this work and are suppressed by the project's `skipLibCheck`.

**KNOWN-RED BASELINE — do not fix, do not edit:** `src/capture/reflector.test.ts > sets sessions.vcc_shrunk_at after a full reflect() pass when compactFileInPlace succeeds` fails on `main` before this work starts. It asserts behaviour that a deliberate safety change disabled (`compactFileInPlace` is commented out to stop it destroying raw transcripts). Resolving it belongs to the concurrent VCC workstream, not this one. Baseline is **342 passed / 1 failed**; treat any *other* failure as a real regression introduced by this plan.

**Worktree:** `C:\Fran\claude-nexus\.worktrees\origin-capture-exclusion`, branch `feat/origin-capture-exclusion`, based on `cb73cbc`. All work happens there. Another session is committing to `main` concurrently — do not edit files outside this plan's scope.

---

### Task 0: Repair the broken baseline build

`main` does not currently compile. Fix it first so every later verification step is meaningful. Pre-existing failure, unrelated to this feature.

**Files:**
- Modify: `src/capture/reflector.test.ts:389-394`

**Step 1: Confirm the failure**

Run: `npm run build`
Expected: FAIL — `src/capture/reflector.test.ts(393,37): error TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.`

**Step 2: Implement**

`better-sqlite3`'s `prepare()` takes a single `sql` argument, so the spread is both unnecessary and untypeable. Replace the spy:

```typescript
      const spy = (sql: string) => {
        if (sql.includes('SET superseded_by')) {
          throw new Error('boom — forced supersede failure');
        }
        return originalPrepare(sql);
      };
```

**Step 3: Verify**

Run: `npm run build`
Expected: exits 0, no output.

**Step 4: Commit**

```bash
git add src/capture/reflector.test.ts
git commit -m "fix: repair reflector test spy type error breaking the build"
```

---

### Task 1: Add `exclude` config section

**Files:**
- Modify: `src/core/config.ts:21-56` (interface), `src/core/config.ts:67-102` (DEFAULTS), `src/core/config.ts:125-131` (merge)
- Modify: `extraction_models.yaml` (append section)

**Step 1: Implement**

In `src/core/config.ts`, add to the `NexusConfig` interface after the `capture` block:

```typescript
  // Origin-based capture exclusion. A session matching any entry never writes
  // memories. Top-level (not nested under capture) so the shallow per-section
  // merge below picks up new default entries even when the YAML overrides a
  // sibling key.
  exclude: {
    commands: string[];         // slash-command / skill names, with or without leading '/'
    scheduled_tasks: string[];  // <scheduled-task name="..."> values
  };
```

Add to `DEFAULTS` after the `capture` block:

```typescript
  exclude: {
    commands: [
      'harvest-knowledge',
      'extract-knowledge',
      'add-book-to-encyclopedia',
      'book-encyclopedia-batch',
    ],
    scheduled_tasks: [
      'nexus-memory-distill',
    ],
  },
```

Add to the `cached = {...}` assignment:

```typescript
    exclude: { ...DEFAULTS.exclude, ...loaded.exclude },
```

Append to `extraction_models.yaml`:

```yaml
# Capture exclusion — sessions whose ORIGIN disqualifies them from writing
# memories at all. Book/article processing belongs in the Knowledge bases, not
# Nexus; distill-audit runs otherwise capture commentary about their own
# auditing. Content-level filtering (file bodies from Read/Grep/etc.) is
# separate and lives in src/capture/transcript.ts.
# Also honoured: NEXUS_NO_CAPTURE=1 in the environment.
exclude:
  commands:
    - harvest-knowledge
    - extract-knowledge
    - add-book-to-encyclopedia
    - book-encyclopedia-batch
  scheduled_tasks:
    - nexus-memory-distill
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

**Step 3: Commit**

```bash
git add src/core/config.ts extraction_models.yaml
git commit -m "feat: add capture exclusion config section"
```

---

### Task 2: Origin classifier

Test-warranted: branching logic, regex parsing, and a fail-open contract that other components depend on.

**Files:**
- Create: `src/capture/origin.ts`
- Test: `src/capture/origin.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { classifyOrigin } from './origin.js';

const cfg = { commands: ['harvest-knowledge'], scheduled_tasks: ['nexus-memory-distill'] };

function transcript(...lines: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), 'origin-'));
	const p = join(dir, 'session.jsonl');
	writeFileSync(p, lines.join('\n') + '\n', 'utf-8');
	return p;
}

// Transcripts are JSON-encoded, so the marker's quotes arrive escaped.
const scheduledLine = JSON.stringify({
	type: 'user',
	message: { role: 'user', content: '<scheduled-task name="nexus-memory-distill" file="x">go</scheduled-task>' },
});
const commandLine = JSON.stringify({
	type: 'user',
	message: { role: 'user', content: '<command-name>/harvest-knowledge</command-name>' },
});
const plainLine = JSON.stringify({
	type: 'user',
	message: { role: 'user', content: 'refactor the auth module' },
});

describe('classifyOrigin', () => {
	it('excludes on NEXUS_NO_CAPTURE without needing a transcript', () => {
		const v = classifyOrigin('/does/not/exist.jsonl', cfg, { NEXUS_NO_CAPTURE: '1' });
		expect(v.excluded).toBe(true);
		expect(v.reason).toBe('NEXUS_NO_CAPTURE');
	});

	it('ignores NEXUS_NO_CAPTURE=0', () => {
		expect(classifyOrigin(transcript(plainLine), cfg, { NEXUS_NO_CAPTURE: '0' }).excluded).toBe(false);
	});

	it('excludes a denylisted scheduled task through JSON escaping', () => {
		const v = classifyOrigin(transcript(scheduledLine), cfg, {});
		expect(v.excluded).toBe(true);
		expect(v.reason).toBe('scheduled-task:nexus-memory-distill');
	});

	it('excludes a denylisted command', () => {
		const v = classifyOrigin(transcript(commandLine), cfg, {});
		expect(v.excluded).toBe(true);
		expect(v.reason).toBe('command:/harvest-knowledge');
	});

	it('does not exclude an ordinary session', () => {
		expect(classifyOrigin(transcript(plainLine), cfg, {}).excluded).toBe(false);
	});

	it('fails OPEN when the transcript is missing', () => {
		expect(classifyOrigin('/does/not/exist.jsonl', cfg, {}).excluded).toBe(false);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts src/capture/origin.test.ts`
Expected: FAIL — cannot resolve `./origin.js`.

**Step 3: Write minimal implementation**

```typescript
/**
 * Origin classifier — decides whether a session may write memories at all.
 *
 * Capture noise has three sources. Two of them are about WHO is running:
 * book/article processing (prose insights that belong in the Knowledge bases,
 * not Nexus) and distill-audit runs (the system generating memories about
 * auditing its own memories, a self-feeding loop). This module owns those. The
 * third — file content read during ordinary work — is a WHAT question and is
 * handled by the tool-result scrubber in transcript.ts.
 *
 * Consumed by reflect() for live capture and by scripts/purge-origin.mjs for the
 * retroactive pass, so historical and going-forward rules cannot drift apart.
 */

import { readFileSync, existsSync } from 'fs';

export interface OriginVerdict {
	excluded: boolean;
	reason: string | null;
}

export interface ExcludeConfig {
	commands: string[];
	scheduled_tasks: string[];
}

const NOT_EXCLUDED: OriginVerdict = { excluded: false, reason: null };

/** Origin markers live in the opening turns; no need to scan a 40MB transcript. */
const SCAN_CHARS = 40_000;

// Transcript lines are JSON-encoded, so a marker written as name="x" is stored
// as name=\"x\". Tolerate the optional backslash on both sides of the value.
const SCHEDULED_TASK_RE = /<scheduled-task\s+name=\\?"([^"\\]+)/g;
const COMMAND_NAME_RE = /<command-name>\\?\/?([a-z0-9:_-]+)<\/command-name>/gi;

const normalize = (s: string) => s.replace(/^\//, '').toLowerCase();

export function classifyOrigin(
	transcriptPath: string,
	cfg: ExcludeConfig,
	env: NodeJS.ProcessEnv = process.env,
): OriginVerdict {
	// Explicit opt-out wins and needs no transcript, so a wrapper script can
	// silence capture for anything (CI, manual bulk runs) without config edits.
	const optOut = env.NEXUS_NO_CAPTURE;
	if (optOut && optOut !== '0' && optOut.toLowerCase() !== 'false') {
		return { excluded: true, reason: 'NEXUS_NO_CAPTURE' };
	}

	let head: string;
	try {
		if (!existsSync(transcriptPath)) return NOT_EXCLUDED;
		head = readFileSync(transcriptPath, 'utf-8').slice(0, SCAN_CHARS);
	} catch {
		// Fail OPEN. A classifier that cannot read the transcript must never be
		// the reason a real memory is silently lost.
		return NOT_EXCLUDED;
	}

	const tasks = (cfg.scheduled_tasks ?? []).map(normalize);
	for (const m of head.matchAll(SCHEDULED_TASK_RE)) {
		if (tasks.includes(normalize(m[1]))) {
			return { excluded: true, reason: `scheduled-task:${m[1]}` };
		}
	}

	const commands = (cfg.commands ?? []).map(normalize);
	for (const m of head.matchAll(COMMAND_NAME_RE)) {
		const name = normalize(m[1]);
		if (commands.includes(name)) {
			return { excluded: true, reason: `command:/${name}` };
		}
	}

	return NOT_EXCLUDED;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.ts src/capture/origin.test.ts`
Expected: PASS, 6 tests.

**Step 5: Commit**

```bash
git add src/capture/origin.ts src/capture/origin.test.ts
git commit -m "feat: add session origin classifier for capture exclusion"
```

---

### Task 3: Scrub content-tool results from the raw window

Test-warranted: parsing + branching, and the placement (rawLines, not text) is the whole point of the change.

**Files:**
- Modify: `src/capture/transcript.ts:46-81` (Block interface + renderContent), `src/capture/transcript.ts:99-125` (window loop)
- Test: `src/capture/transcript.test.ts` (append)

**Step 1: Write the failing test**

Append to `src/capture/transcript.test.ts`:

```typescript
describe('content-tool result scrubbing', () => {
	const mk = (blocks: unknown[], role = 'assistant') =>
		JSON.stringify({ type: role, message: { role, content: blocks } });

	it('drops a successful Read body from BOTH text and rawLines', () => {
		const p = writeTranscript([
			mk([{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } }]),
			mk([{ type: 'tool_result', tool_use_id: 't1', content: 'SECRET FILE CONTENT' }], 'user'),
		]);
		const w = readTranscriptWindow(p, 0);
		expect(w.text).not.toContain('SECRET FILE CONTENT');
		expect(w.rawLines.join('\n')).not.toContain('SECRET FILE CONTENT');
	});

	it('keeps an error body — tool failures are where tool_quirks come from', () => {
		const p = writeTranscript([
			mk([{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]),
			mk([{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'EACCES denied' }], 'user'),
		]);
		const w = readTranscriptWindow(p, 0);
		expect(w.text).toContain('EACCES denied');
	});

	it('keeps a successful non-content tool body', () => {
		const p = writeTranscript([
			mk([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]),
			mk([{ type: 'tool_result', tool_use_id: 't1', content: 'branch is clean' }], 'user'),
		]);
		expect(readTranscriptWindow(p, 0).text).toContain('branch is clean');
	});

	it('scrubs a result whose tool_use fell outside the window', () => {
		const p = writeTranscript([
			mk([{ type: 'tool_result', tool_use_id: 'unknown', content: 'ORPHAN CONTENT' }], 'user'),
		]);
		expect(readTranscriptWindow(p, 0).text).not.toContain('ORPHAN CONTENT');
	});
});
```

> If `writeTranscript` does not already exist in this test file, reuse the existing local helper that writes a temp `.jsonl` (see the top of the file) and adapt the names.

**Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts src/capture/transcript.test.ts`
Expected: FAIL — the Read body is still present in `text` and `rawLines`.

**Step 3: Write minimal implementation**

In `src/capture/transcript.ts`, extend the `Block` interface (line 46):

```typescript
interface Block { type?: string; text?: string; name?: string; id?: string; tool_use_id?: string; input?: unknown; content?: unknown; is_error?: boolean }
```

Add above `renderContent`:

```typescript
/**
 * Tools whose successful output is document/file content rather than a fact
 * about the system. Their bodies are what turns "Claude read a book chapter"
 * into a durable memory about the book. Matched on the bare name or on the
 * trailing segment of an MCP-namespaced name (mcp__server__search_code).
 */
const CONTENT_TOOL_RE = /(^|__)(read|grep|glob|webfetch|websearch|notebookread|search_code|search_unity_knowledge)$/i;

const OMITTED = '<content omitted by nexus capture filter>';

/**
 * Blank successful content-tool result bodies inside one raw JSONL line.
 *
 * Operates on the RAW line, not the condensed text, because reflect() feeds
 * window.rawLines to VCC and uses VCC's output as the extraction text — a
 * filter applied only to the condensed text would be bypassed on that path.
 *
 * Errors always keep their bodies. An unidentifiable tool_use_id is scrubbed
 * rather than kept: leaking file content is the failure being fixed, and the
 * only cost is losing a little context at a window boundary.
 */
function scrubLine(line: string, toolNames: Map<string, string>): string {
	let entry: { message?: { content?: unknown } };
	try { entry = JSON.parse(line); } catch { return line; }
	const content = entry?.message?.content;
	if (!Array.isArray(content)) return line;

	let changed = false;
	for (const b of content as Block[]) {
		if (!b || typeof b !== 'object') continue;
		if (b.type === 'tool_use' && typeof b.id === 'string') {
			toolNames.set(b.id, typeof b.name === 'string' ? b.name : 'tool');
		} else if (b.type === 'tool_result' && !b.is_error) {
			const name = typeof b.tool_use_id === 'string' ? toolNames.get(b.tool_use_id) : undefined;
			if (name === undefined || CONTENT_TOOL_RE.test(name)) {
				b.content = OMITTED;
				changed = true;
			}
		}
	}
	return changed ? JSON.stringify(entry) : line;
}
```

In `readTranscriptWindow`, replace the `const fresh = ...` line and the loop header so the scrub runs once and feeds both outputs:

```typescript
  const fresh = lines.slice(Math.max(0, fromIndex));
  // Scrub before anything consumes the window. Order matters: tool_use always
  // precedes its tool_result, so a single forward pass resolves every id it can.
  const toolNames = new Map<string, string>();
  const scrubbed = fresh.map(l => scrubLine(l, toolNames));
```

Change the render loop to iterate `scrubbed` instead of `fresh`:

```typescript
  for (const line of scrubbed) {
```

Find the `return` at the end of `readTranscriptWindow` and ensure it returns the scrubbed lines:

```typescript
    rawLines: scrubbed,
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.ts src/capture/transcript.test.ts`
Expected: PASS — all existing tests plus the 4 new ones.

**Step 5: Commit**

```bash
git add src/capture/transcript.ts src/capture/transcript.test.ts
git commit -m "feat: scrub content-tool result bodies from capture window"
```

---

### Task 4: Gate `reflect()` on session origin

Test-warranted: a contract other components depend on, and the fail-open behaviour must be pinned.

**Files:**
- Modify: `src/capture/reflector.ts:38-46` (ReflectResult), `src/capture/reflector.ts:52-61` (gate)
- Test: `src/capture/reflector.test.ts` (append)

**Step 1: Write the failing test**

```typescript
it('never extracts from a denylisted scheduled-task session', async () => {
	const db = freshDb();
	const p = writeTranscript([
		JSON.stringify({ type: 'user', message: { role: 'user', content: '<scheduled-task name="nexus-memory-distill" file="x">sweep</scheduled-task>' } }),
		JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'I always prefer tabs over spaces, never use spaces.' } }),
	]);
	let called = false;
	const r = await reflect(db, { session_id: 'sched-1', transcript_path: p, project: 'proj' },
		{ extract: async () => { called = true; return []; }, embed: async () => null });

	expect(called).toBe(false);
	expect(r.skipped).toBe(true);
	expect(r.excluded_reason).toBe('scheduled-task:nexus-memory-distill');
	db.close();
});
```

> Reuse whatever `freshDb` / transcript-writing helpers already exist at the top of `reflector.test.ts`.

**Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts src/capture/reflector.test.ts`
Expected: FAIL — `called` is `true` and `excluded_reason` is undefined.

**Step 3: Write minimal implementation**

Add the import at the top of `src/capture/reflector.ts`:

```typescript
import { classifyOrigin } from './origin.js';
```

Add to `ReflectResult`:

```typescript
  excluded_reason?: string | null;   // set when the origin gate refused the session
```

Insert at the very start of `reflect()`'s body, before the `INSERT OR IGNORE INTO sessions` statement:

```typescript
  // Origin gate. Runs before the session row is created and before the
  // transcript is read, so an excluded session costs nothing. Deliberately does
  // NOT advance a cursor: if the denylist later changes, the session becomes
  // eligible again from the top.
  const origin = classifyOrigin(opts.transcript_path, getNexusConfig().exclude);
  if (origin.excluded) {
    return {
      session_id: opts.session_id, project: opts.project, newLines: 0,
      extracted: 0, inserted: 0, merged: 0, skipped: true,
      excluded_reason: origin.reason,
    };
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.ts src/capture/reflector.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/capture/reflector.ts src/capture/reflector.test.ts
git commit -m "feat: gate reflect() on session origin"
```

---

### Task 5: Surface the exclusion reason in both callers

Glue only — no tests.

**Files:**
- Modify: `src/capture/runner.ts:117-122`
- Modify: `src/web/server.ts:93-94`

**Step 1: Implement**

In `src/capture/runner.ts`, replace the result-logging block:

```typescript
    if (result.excluded_reason) {
      console.error(`[nexus-reflect] skipped: origin excluded (${result.excluded_reason})`);
    } else if (!result.skipped && (result.inserted > 0 || result.merged > 0)) {
      const exp = exportAll(db);
      console.error(`[nexus-reflect] ${JSON.stringify({ ...result, exported: exp.files })}`);
    } else {
      console.error(`[nexus-reflect] ${JSON.stringify(result)}`);
    }
```

In `src/web/server.ts`, replace the log line after the `reflect` call:

```typescript
      if (!result.skipped && (result.inserted > 0 || result.merged > 0)) exportAll(db);
      console.log('[web] reflect:', JSON.stringify(result));
```

with:

```typescript
      if (!result.skipped && (result.inserted > 0 || result.merged > 0)) exportAll(db);
      if (result.excluded_reason) console.log(`[web] reflect: origin excluded (${result.excluded_reason})`);
      else console.log('[web] reflect:', JSON.stringify(result));
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

**Step 3: Commit**

```bash
git add src/capture/runner.ts src/web/server.ts
git commit -m "feat: log origin-exclusion reason in both reflect callers"
```

---

### Task 6: Retroactive purge script

Follows the existing `scripts/*.mjs` convention (`rollback-distill.mjs`): dry-run by default, snapshot before writing, no unit test.

**Files:**
- Create: `scripts/purge-origin.mjs`

**Step 1: Implement**

```javascript
/**
 * Remove memories captured from sessions that today's exclusion rules would
 * have refused — book/article processing and distill-audit runs.
 *
 * Reuses classifyOrigin, so this pass and live capture can never disagree.
 * Resolution is source_session_id -> transcript .jsonl under ~/.claude/projects.
 *
 * FAILS CLOSED: a memory whose transcript no longer exists is reported and
 * KEPT, never deleted. Distill-generated merges (source_session_id IS NULL) are
 * out of scope — they have no session to classify.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write; a VACUUM INTO snapshot is taken
 * first and its path printed, which is the rollback.
 *
 * Usage: node scripts/purge-origin.mjs [--apply] [--out report.json]
 */

// openDatabase (not raw better-sqlite3): deleting a memory fires the
// memories_vec_ad trigger, which needs the sqlite-vec extension loaded.
import { openDatabase } from '../dist/core/database.js';
import { getNexusConfig } from '../dist/core/config.js';
import { classifyOrigin } from '../dist/capture/origin.js';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const outIdx = args.indexOf('--out');
const outPath = outIdx === -1 ? '.flow/purge-origin-report.json' : args[outIdx + 1];

const projectsDir = join(homedir(), '.claude', 'projects');
const cfg = getNexusConfig().exclude;
const db = openDatabase();

// Env opt-out must not leak into the purge: it describes THIS process, not the
// sessions being classified.
const env = { ...process.env, NEXUS_NO_CAPTURE: '' };

let projectDirs = [];
try { projectDirs = readdirSync(projectsDir); } catch { /* no transcripts at all */ }

const transcriptFor = (project, sessionId) => {
	if (project) {
		const direct = join(projectsDir, project, `${sessionId}.jsonl`);
		if (existsSync(direct)) return direct;
	}
	for (const d of projectDirs) {
		const p = join(projectsDir, d, `${sessionId}.jsonl`);
		if (existsSync(p)) return p;
	}
	return null;
};

const rows = db.prepare(`
	SELECT id, title, project, source_session_id
	FROM memories
	WHERE superseded_by IS NULL AND source_session_id IS NOT NULL
`).all();

const doomed = [];
const unresolved = [];
const sessionVerdicts = new Map();

for (const r of rows) {
	let verdict = sessionVerdicts.get(r.source_session_id);
	if (verdict === undefined) {
		const path = transcriptFor(r.project, r.source_session_id);
		verdict = path ? classifyOrigin(path, cfg, env) : null;
		sessionVerdicts.set(r.source_session_id, verdict);
	}
	if (verdict === null) unresolved.push(r);
	else if (verdict.excluded) doomed.push({ ...r, reason: verdict.reason });
}

const byReason = {};
for (const d of doomed) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;

console.log(`scanned      : ${rows.length} live memories with a session`);
console.log(`sessions     : ${sessionVerdicts.size} distinct`);
console.log(`unresolved   : ${unresolved.length} (transcript gone — KEPT)`);
console.log(`to remove    : ${doomed.length}`);
for (const [reason, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
	console.log(`   ${String(n).padStart(5)}  ${reason}`);
}

writeFileSync(outPath, JSON.stringify({ apply, byReason, doomed, unresolved }, null, 2));
console.log(`\nwrote report to ${outPath}`);

if (!apply) {
	console.log('\nDRY RUN — nothing written. Re-run with --apply to delete.');
	process.exit(0);
}

if (doomed.length === 0) {
	console.log('\nnothing to delete.');
	process.exit(0);
}

const snapshot = join(homedir(), '.claude', 'memories', `nexus.pre-purge-${Date.now()}.db`);
db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
console.log(`\nsnapshot: ${snapshot}`);

const del = db.prepare('DELETE FROM memories WHERE id = ?');
const run = db.transaction((list) => { for (const d of list) del.run(d.id); });
run(doomed);

console.log(`deleted ${doomed.length} memories. Restore by replacing nexus.db with the snapshot above.`);
```

**Step 2: Verify**

Run: `npm run build && node scripts/purge-origin.mjs`
Expected: a scan summary, a `to remove` count, `wrote report to .flow/purge-origin-report.json`, and `DRY RUN — nothing written.` No database mutation.

**Step 3: Commit**

```bash
git add scripts/purge-origin.mjs
git commit -m "feat: add retroactive origin-based memory purge script"
```

---

### Task 7: Full build and test suite

**Files:** none (verification only)

**Step 1: Verify**

Run: `npm run build && npm test`
Expected: tsc exits clean; the full Vitest suite passes with no regressions. If any pre-existing test fails, report it rather than editing the test to pass.

**Step 2: Commit**

```bash
git add -A dist
git commit -m "chore: rebuild dist for capture exclusion"
```

---

### Task 8: Review the purge dry-run before applying

**Files:** none (human checkpoint)

**Step 1: Verify**

Run: `node scripts/purge-origin.mjs --out .flow/purge-origin-report.json`

Report back to the user, and **stop for approval**:
- `to remove` total and the per-reason breakdown
- `unresolved` count — memories whose transcripts are gone and which therefore cannot be cleaned
- a sample of 10 titles from `doomed`, so the user can sanity-check that nothing valuable is in the list

Do **not** run `--apply` without explicit user approval. Deletion is the one irreversible step in this plan (mitigated only by the snapshot).

---

### Task 9: Finish the branch

**Step 1:** Invoke the `finish-branch` skill to merge the worktree back to `main` and remove it.

---

### Task 10: Update documentation

**Step 1:** Invoke `/update-project-docs`, ensuring it covers:
- An **ADR** for the origin-exclusion model: why origin-based rather than project-slug denylist; why the gate lives inside `reflect()` rather than in the two callers; why scrubbing targets `rawLines` (VCC bypass); fail-open live vs fail-closed purge.
- **file-map** entries for `src/capture/origin.ts` and `scripts/purge-origin.mjs`.
- A fix for the stale `hooks/hooks.json` row in the CLAUDE.md Key Files table — no such file exists anywhere in the repo.
- A CLAUDE.md note that `NEXUS_NO_CAPTURE=1` disables capture for a session.
