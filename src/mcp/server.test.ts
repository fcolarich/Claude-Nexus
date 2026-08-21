/**
 * Tests for nexus_promotions and nexus_mark_promoted tool logic.
 *
 * Approach A: exercise the underlying SQL + update logic against an isolated
 * :memory: DB seeded via insertMemory/getMemory — no server import, no real DB.
 * Mirrors the precedent in src/core/memories.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openDatabase, initializeSchema } from '../core/database.js';
import { insertMemory, getMemory, type MemoryInput } from '../core/memories.js';
import { searchSession, getStats, type SessionSearchResult } from '../core/search.js';
import { extractIdentifiers, unionIdentifiers } from '../core/identifiers.js';
import type Database from 'better-sqlite3';
import type { Session } from '../core/types.js';

function freshDb(): Database.Database {
	const db = openDatabase(':memory:');
	initializeSchema(db);
	return db;
}

const noEmbed = async (_id: string): Promise<boolean> => false;

/** Base memory input — override individual fields per test. */
function memInput(overrides: Partial<MemoryInput> = {}): MemoryInput {
	return {
		title: 'Test memory',
		body: 'Some architectural decision body ' + Math.random(),
		memory_type: 'decision',
		scope: 'project',
		project: 'test-proj',
		confidence: 0.9,
		decay_class: 'stable',
		review_status: 'approved',
		source_session_id: null,
		discovered_from: null,
		tags: [],
		promotion_target: 'adr',
		load_at_init: false,
		...overrides,
	};
}

// ── nexus_promotions query logic ──────────────────────────────────────

/**
 * Runs the exact SQL from the nexus_promotions handler against the given db.
 * Optional project/target filters mirror what the tool does.
 */
function queryPromotionCandidates(
	db: Database.Database,
	opts: { project?: string; target?: string } = {},
): { id: string; title: string; body: string; confidence: number; source_session_id: string | null; promotion_target: string }[] {
	let sql = `SELECT id, title, body, confidence, source_session_id, promotion_target
               FROM memories
               WHERE promotion_target != 'none'
                 AND promoted_to IS NULL
                 AND review_status != 'rejected'
                 AND superseded_by IS NULL`;
	const params: string[] = [];

	if (opts.project) {
		sql += ` AND project = ?`;
		params.push(opts.project);
	}
	if (opts.target) {
		sql += ` AND promotion_target = ?`;
		params.push(opts.target);
	}

	sql += ` ORDER BY promotion_target, confidence DESC`;
	return db.prepare(sql).all(...params) as ReturnType<typeof queryPromotionCandidates>;
}

/**
 * Runs the exact body-rewrite + UPDATE from the nexus_mark_promoted handler.
 * Returns the success text or an error string, mirroring the tool's content[0].text.
 */
async function runMarkPromoted(
	db: Database.Database,
	id: string,
	artifact_ref: string,
	embedFn: (id: string) => Promise<boolean> = noEmbed,
): Promise<string> {
	const memory = getMemory(db, id);
	if (!memory) {
		return `Error: memory not found with id ${id}`;
	}

	// D-006: rewrite body to thin pointer — first sentence → artifact_ref,
	// appending the ref only if it is not already present.
	const firstSentence = memory.body.split(/(?<=[.!?])\s/)[0].trim();
	const newBody = firstSentence && !firstSentence.includes(artifact_ref)
		? `${firstSentence} → ${artifact_ref}`
		: firstSentence;

	const newIdentifiers = unionIdentifiers(memory.identifiers, extractIdentifiers(newBody));

	db.prepare(
		`UPDATE memories SET body = ?, promoted_to = ?, identifiers = ?, updated_at = datetime('now') WHERE id = ?`,
	).run(newBody, artifact_ref, JSON.stringify(newIdentifiers), id);

	// D-005: re-embed the rewritten body — best-effort, failure does not fail
	embedFn(id).catch(() => {});

	return `"${memory.title}" marked promoted → ${artifact_ref}`;
}

// ─────────────────────────────────────────────────────────────────────
// Tests: nexus_promotions
// ─────────────────────────────────────────────────────────────────────

describe('nexus_promotions query logic', () => {
	it('includes a valid candidate (promotion_target=adr, promoted_to=NULL, approved, superseded_by=NULL)', () => {
		const db = freshDb();
		const { id } = insertMemory(db, memInput({ promotion_target: 'adr' }));
		const rows = queryPromotionCandidates(db);
		expect(rows.map(r => r.id)).toContain(id);
		db.close();
	});

	it('excludes a memory where promoted_to is already set', () => {
		const db = freshDb();
		const { id } = insertMemory(db, memInput({ promotion_target: 'adr' }));
		db.prepare(`UPDATE memories SET promoted_to = 'ADR-001' WHERE id = ?`).run(id);
		const rows = queryPromotionCandidates(db);
		expect(rows.map(r => r.id)).not.toContain(id);
		db.close();
	});

	it('excludes a memory with review_status=rejected', () => {
		const db = freshDb();
		const { id } = insertMemory(db, memInput({ promotion_target: 'adr', review_status: 'rejected' }));
		const rows = queryPromotionCandidates(db);
		expect(rows.map(r => r.id)).not.toContain(id);
		db.close();
	});

	it('excludes a memory where superseded_by is set', () => {
		const db = freshDb();
		const { id } = insertMemory(db, memInput({ promotion_target: 'adr' }));
		const { id: supersedingId } = insertMemory(db, memInput({ body: 'the superseding memory.', promotion_target: 'adr' }));
		db.prepare(`UPDATE memories SET superseded_by = ? WHERE id = ?`).run(supersedingId, id);
		const rows = queryPromotionCandidates(db);
		expect(rows.map(r => r.id)).not.toContain(id);
		db.close();
	});

	it('excludes a memory with promotion_target=none', () => {
		const db = freshDb();
		const { id } = insertMemory(db, memInput({ promotion_target: 'none' }));
		const rows = queryPromotionCandidates(db);
		expect(rows.map(r => r.id)).not.toContain(id);
		db.close();
	});

	it('returns only the valid candidate when mixed with excluded ones', () => {
		const db = freshDb();
		const { id: good } = insertMemory(db, memInput({ body: 'valid candidate body.', promotion_target: 'adr' }));

		const { id: alreadyPromoted } = insertMemory(db, memInput({ body: 'already promoted body.', promotion_target: 'adr' }));
		db.prepare(`UPDATE memories SET promoted_to = 'ADR-001' WHERE id = ?`).run(alreadyPromoted);

		const { id: rejected } = insertMemory(db, memInput({ body: 'rejected body.', promotion_target: 'adr', review_status: 'rejected' }));

		const { id: superseded } = insertMemory(db, memInput({ body: 'superseded body.', promotion_target: 'adr' }));
		const { id: supersedingId } = insertMemory(db, memInput({ body: 'the superseding memory 2.', promotion_target: 'adr' }));
		db.prepare(`UPDATE memories SET superseded_by = ? WHERE id = ?`).run(supersedingId, superseded);

		insertMemory(db, memInput({ body: 'not a candidate body.', promotion_target: 'none' }));

		const rows = queryPromotionCandidates(db);
		const ids = rows.map(r => r.id);
		expect(ids).toContain(good);
		expect(ids).not.toContain(alreadyPromoted);
		expect(ids).not.toContain(rejected);
		expect(ids).not.toContain(superseded);
		db.close();
	});

	it('target filter narrows to one group', () => {
		const db = freshDb();
		const { id: adrId } = insertMemory(db, memInput({ body: 'adr body.', promotion_target: 'adr' }));
		const { id: ddrId } = insertMemory(db, memInput({ body: 'ddr body.', promotion_target: 'ddr' }));

		const adrOnly = queryPromotionCandidates(db, { target: 'adr' });
		expect(adrOnly.map(r => r.id)).toContain(adrId);
		expect(adrOnly.map(r => r.id)).not.toContain(ddrId);

		const ddrOnly = queryPromotionCandidates(db, { target: 'ddr' });
		expect(ddrOnly.map(r => r.id)).toContain(ddrId);
		expect(ddrOnly.map(r => r.id)).not.toContain(adrId);
		db.close();
	});

	it('returns empty result when no candidates exist', () => {
		const db = freshDb();
		// All candidates excluded: none with promotion_target != 'none' eligible
		insertMemory(db, memInput({ promotion_target: 'none' }));
		const rows = queryPromotionCandidates(db);
		expect(rows).toHaveLength(0);
		db.close();
	});

	it('results are ordered by promotion_target then confidence DESC', () => {
		const db = freshDb();
		// Two ADR candidates with different confidences, one DDR
		insertMemory(db, memInput({ body: 'adr low conf.', promotion_target: 'adr', confidence: 0.6 }));
		insertMemory(db, memInput({ body: 'adr high conf.', promotion_target: 'adr', confidence: 0.95 }));
		insertMemory(db, memInput({ body: 'ddr candidate.', promotion_target: 'ddr', confidence: 0.8 }));

		const rows = queryPromotionCandidates(db);
		// adr comes before ddr alphabetically
		const adrRows = rows.filter(r => r.promotion_target === 'adr');
		expect(adrRows[0].confidence).toBeGreaterThan(adrRows[1].confidence);
		const targets = rows.map(r => r.promotion_target);
		expect(targets.indexOf('adr')).toBeLessThan(targets.indexOf('ddr'));
		db.close();
	});
});

// ─────────────────────────────────────────────────────────────────────
// Tests: nexus_mark_promoted
// ─────────────────────────────────────────────────────────────────────

describe('nexus_mark_promoted logic', () => {
	it('rewrites body to first sentence → artifact_ref (AC-3)', async () => {
		const db = freshDb();
		const { id } = insertMemory(db, memInput({
			body: 'Use tabs for indentation. Never use spaces. This is a convention.',
			promotion_target: 'adr',
		}));

		await runMarkPromoted(db, id, 'ADR-063');

		const updated = getMemory(db, id);
		expect(updated!.body).toBe('Use tabs for indentation. → ADR-063');
		db.close();
	});

	it('preserves identifiers from the original body even though the pointer body drops them (ADR-20260808214308-a0 regression)', async () => {
		const db = freshDb();
		const { id } = insertMemory(db, memInput({
			body: 'This is unrelated filler that becomes the pointer. The MERGE_COVERAGE_FLOOR in src/core/distill.ts is 0.72.',
			promotion_target: 'adr',
		}));

		await runMarkPromoted(db, id, 'ADR-063');

		const row = db.prepare(`SELECT body, identifiers FROM memories WHERE id = ?`).get(id) as { body: string; identifiers: string };
		// The pointer body itself no longer names the identifiers...
		expect(row.body).not.toContain('MERGE_COVERAGE_FLOOR');
		// ...but the identifiers column still carries them forward.
		const ids = JSON.parse(row.identifiers) as string[];
		expect(ids).toContain('MERGE_COVERAGE_FLOOR');
		expect(ids).toContain('src/core/distill.ts');
		db.close();
	});

	it('sets promoted_to to the artifact_ref', async () => {
		const db = freshDb();
		const { id } = insertMemory(db, memInput({ body: 'The decision here.', promotion_target: 'adr' }));

		await runMarkPromoted(db, id, 'ADR-063');

		const row = db.prepare(`SELECT promoted_to FROM memories WHERE id = ?`).get(id) as { promoted_to: string };
		expect(row.promoted_to).toBe('ADR-063');
		db.close();
	});

	it('does not touch title', async () => {
		const db = freshDb();
		const originalTitle = 'My important decision';
		const { id } = insertMemory(db, memInput({ title: originalTitle, body: 'Decision body.', promotion_target: 'adr' }));

		await runMarkPromoted(db, id, 'ADR-063');

		const updated = getMemory(db, id);
		expect(updated!.title).toBe(originalTitle);
		db.close();
	});

	it('does not touch review_status', async () => {
		const db = freshDb();
		const { id } = insertMemory(db, memInput({ body: 'Decision body.', promotion_target: 'adr', review_status: 'approved' }));

		await runMarkPromoted(db, id, 'ADR-063');

		const updated = getMemory(db, id);
		expect(updated!.review_status).toBe('approved');
		db.close();
	});

	it('does not append ref again if already present in first sentence', async () => {
		const db = freshDb();
		const body = 'See ADR-063 for context. And more text here.';
		const { id } = insertMemory(db, memInput({ body, promotion_target: 'adr' }));

		await runMarkPromoted(db, id, 'ADR-063');

		const updated = getMemory(db, id);
		// firstSentence includes ADR-063 so no arrow appended
		expect(updated!.body).toBe('See ADR-063 for context.');
		db.close();
	});

	it('invokes embed function for the promoted memory (D-005)', async () => {
		const db = freshDb();
		const { id } = insertMemory(db, memInput({ body: 'Embed me.', promotion_target: 'adr' }));

		const embedded: string[] = [];
		const trackEmbed = async (memId: string): Promise<boolean> => {
			embedded.push(memId);
			return false; // failure is best-effort
		};

		await runMarkPromoted(db, id, 'ADR-063', trackEmbed);

		// Give the .catch promise microtask a tick to settle
		await new Promise(r => setTimeout(r, 0));
		expect(embedded).toContain(id);
		db.close();
	});

	it('still reports success even when embed returns false (D-005)', async () => {
		const db = freshDb();
		const { id } = insertMemory(db, memInput({ body: 'No embed available.', promotion_target: 'adr' }));

		const failEmbed = async (_id: string): Promise<boolean> => false;
		const result = await runMarkPromoted(db, id, 'ADR-063', failEmbed);

		expect(result).toMatch(/marked promoted → ADR-063/);
		db.close();
	});

	it('returns error text for unknown id, performs no write', async () => {
		const db = freshDb();
		const { id } = insertMemory(db, memInput({ body: 'Real memory.', promotion_target: 'adr' }));

		const result = await runMarkPromoted(db, 'nonexistent-id', 'ADR-063');

		expect(result).toMatch(/Error: memory not found/);
		// Real memory untouched
		const row = db.prepare(`SELECT promoted_to FROM memories WHERE id = ?`).get(id) as { promoted_to: string | null };
		expect(row.promoted_to).toBeNull();
		db.close();
	});
});

// ─────────────────────────────────────────────────────────────────────
// Tests: nexus_sessions — transcript_path field
//
// Approach A (see file header): mirrors the exact formatting logic from
// the nexus_sessions handler rather than importing server.ts (McpServer
// exposes no public accessor for registered tool handlers). Keep this
// function's body in sync with the handler in ../mcp/server.ts.
// ─────────────────────────────────────────────────────────────────────

/** Minimal valid Session fixture — override individual fields per test. */
function baseSession(overrides: Partial<Session> = {}): Session {
	return {
		session_id: 's1',
		project: 'test-project',
		git_branch: null,
		slug: null,
		jsonl_path: '/tmp/session.jsonl',
		started_at: null,
		last_active: null,
		status: 'idle',
		input_tokens: 0,
		output_tokens: 0,
		estimated_cost: 0,
		subagent_count: 0,
		summary: null,
		message_count: 0,
		title: null,
		custom_title: null,
		is_cowork: null,
		workspace_id: null,
		participant_id: null,
		last_reflected_index: 0,
		cwd: null,
		...overrides,
	};
}

/** Mirrors the current nexus_sessions handler's text-formatting logic (server.ts). */
function formatSessionsList(sessions: Session[]): string {
	const lines = sessions.slice(0, 20).map(s => {
		const branch = s.git_branch ? ` (${s.git_branch})` : '';
		const date = s.last_active ? new Date(s.last_active).toLocaleDateString() : 'unknown';
		const transcriptPath = s.jsonl_path ? s.jsonl_path : '(none)';
		return `- **[${s.status}]** ${s.project}${branch} — ${date}, ${s.message_count} msgs, ${s.subagent_count} subagents\n  transcript_path: ${transcriptPath}${s.summary ? `\n  ${s.summary.slice(0, 120)}` : ''}`;
	});
	return `# Sessions (${sessions.length} total)\n\n${lines.join('\n')}`;
}

describe('nexus_sessions transcript_path field', () => {
	it('includes transcript_path: <path> for a session with a populated jsonl_path', () => {
		const session = baseSession({ jsonl_path: '/tmp/sess-populated.jsonl' });
		const text = formatSessionsList([session]);
		expect(text).toContain('transcript_path: /tmp/sess-populated.jsonl');
	});

	it('emits the literal transcript_path: (none) for an empty jsonl_path, never omitting the key', () => {
		const session = baseSession({ jsonl_path: '' });
		const text = formatSessionsList([session]);
		expect(text).toContain('transcript_path: (none)');
	});
});

// ─────────────────────────────────────────────────────────────────────
// Tests: nexus_search_session
//
// Mirrors this file's established convention (see nexus_sessions above):
// McpServer exposes no public accessor for registered tool handlers, and
// server.ts opens a real db + connects stdio transport as an import-time
// side effect, so importing server.ts here is unsafe. `renderSessionSearch`
// and the query-trim/reject handler logic are duplicated locally, mirroring
// the module-local functions in ../mcp/server.ts. Keep both in sync.
// ─────────────────────────────────────────────────────────────────────

/** Mirrors the module-local renderSessionSearch in ../mcp/server.ts. */
function renderSessionSearch(r: SessionSearchResult): string {
	if (r.status === 'session-not-found') {
		return r.detail ?? `No session found for session_id "${r.sessionId}"`;
	}
	if (r.status === 'no-content') {
		return r.detail ?? `No content available for session ${r.sessionId}.`;
	}
	if (r.status === 'no-matches') {
		const searched = r.sourcesChecked.length > 0 ? r.sourcesChecked.join(', ') : 'nothing';
		return `No matches for "${r.query}" in session ${r.sessionId}. Searched: ${searched}.`;
	}

	// status === 'ok'
	const lines = r.matches.map(m => `- line ${m.line} (${m.occurrences} occurrence${m.occurrences === 1 ? '' : 's'}): ${m.snippet}`);
	const truncNote = r.truncated ? `\n(truncated — ${r.totalMatches} total matches, showing ${r.matches.length})` : '';
	return `Source: ${r.source} (${r.totalMatches} match${r.totalMatches === 1 ? '' : 'es'})\n\n${lines.join('\n')}${truncNote}`;
}

/** Mirrors the nexus_search_session handler in ../mcp/server.ts. */
function runSearchSessionHandler(
	db: Database.Database,
	sessionId: string,
	query: string,
	maxMatches?: number,
): string {
	const trimmed = query.trim();
	if (!trimmed) {
		return 'Error: query must not be empty.';
	}
	const result = searchSession(db, sessionId, trimmed, { maxMatches });
	return renderSessionSearch(result);
}

describe('nexus_search_session handler', () => {
	let tmpDir: string;

	function freshSearchDb(): Database.Database {
		const db = openDatabase(':memory:') as unknown as Database.Database;
		initializeSchema(db);
		return db;
	}

	function insertSession(db: Database.Database, o: { id: string; jsonlPath?: string | null; vccShrunkPath?: string | null }) {
		db.prepare(`
			INSERT INTO sessions (session_id, project, jsonl_path, vcc_shrunk_path)
			VALUES (?, ?, ?, ?)
		`).run(o.id, 'test-proj', o.jsonlPath ?? null, o.vccShrunkPath ?? null);
	}

	function countLogRows(db: Database.Database, sessionId: string): number {
		return (db.prepare(`SELECT COUNT(*) as c FROM session_search_log WHERE session_id = ?`).get(sessionId) as { c: number }).c;
	}

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'nexus-search-session-tool-'));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('matches-found: renders source, match count, and a bullet per snippet', () => {
		const db = freshSearchDb();
		const jsonlPath = join(tmpDir, 'tool-1.jsonl');
		writeFileSync(jsonlPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'find the needle please' } }) + '\n', 'utf8');
		insertSession(db, { id: 'tool-1', jsonlPath, vccShrunkPath: null });

		const text = runSearchSessionHandler(db, 'tool-1', 'needle');

		expect(text).toContain('Source: full');
		expect(text).toMatch(/- line \d+ \(\d+ occurrence/);
		expect(text).toContain('needle');
		db.close();
	});

	it('no-matches: renders the "No matches" message naming both sources checked', () => {
		const db = freshSearchDb();
		const compactedPath = join(tmpDir, 'tool-2.compacted.txt');
		writeFileSync(compactedPath, 'nothing relevant here', 'utf8');
		const jsonlPath = join(tmpDir, 'tool-2.jsonl');
		writeFileSync(jsonlPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'still nothing relevant' } }) + '\n', 'utf8');
		insertSession(db, { id: 'tool-2', jsonlPath, vccShrunkPath: compactedPath });

		const text = runSearchSessionHandler(db, 'tool-2', 'needle');

		expect(text).toBe('No matches for "needle" in session tool-2. Searched: compacted summary, full transcript.');
		db.close();
	});

	it('session-not-found: renders a clear not-found message', () => {
		const db = freshSearchDb();

		const text = runSearchSessionHandler(db, 'ghost-session', 'anything');

		expect(text).toMatch(/no session found/i);
		expect(text).toContain('ghost-session');
		db.close();
	});

	it('empty-query-rejection: rejects a whitespace-only query without calling searchSession', () => {
		const db = freshSearchDb();
		insertSession(db, { id: 'tool-3', jsonlPath: '', vccShrunkPath: null });

		const text = runSearchSessionHandler(db, 'tool-3', '   ');

		expect(text).toBe('Error: query must not be empty.');
		// searchSession always logs on every terminal path -- zero rows proves it was never invoked.
		expect(countLogRows(db, 'tool-3')).toBe(0);
		db.close();
	});
});

// ─────────────────────────────────────────────────────────────────────
// Tests: nexus_stats — session-search counts line
//
// Mirrors this file's established convention (see nexus_sessions,
// nexus_search_session above): McpServer exposes no public accessor for
// registered tool handlers, so the handler's text-formatting logic is
// duplicated locally. Keep in sync with the handler in ../mcp/server.ts.
// ─────────────────────────────────────────────────────────────────────

/** Mirrors the nexus_stats handler's text-formatting logic in ../mcp/server.ts. */
function formatStats(stats: ReturnType<typeof getStats>): string {
	const reviewSummary = Object.entries(stats.memoriesByReview).map(([s, c]) => `${s}(${c})`).join(', ') || 'none';

	return `# Nexus Stats

**Total Atoms:** ${stats.totalAtoms} (${stats.embeddedAtoms} embedded)
**By Type:** ${Object.entries(stats.atomsByType).map(([t, c]) => `${t}(${c})`).join(', ')}
**By Scope:** ${Object.entries(stats.atomsByScope).map(([s, c]) => `${s}(${c})`).join(', ')}
**By Project:** ${Object.entries(stats.atomsByProject).map(([p, c]) => `${p}(${c})`).join(', ')}
**Memories:** ${stats.totalMemories} (${stats.embeddedMemories} embedded) — review: ${reviewSummary}
**Links:** ${stats.totalLinks}
**Sessions:** ${stats.totalSessions}
**Diagnostics:** ${stats.totalDiagnostics}
**Session searches:** ${stats.totalSessionSearches} total (compacted: ${stats.sessionSearchesBySource.compacted}, full: ${stats.sessionSearchesBySource.full}, none: ${stats.sessionSearchesBySource.none})`;
}

describe('nexus_stats session-search counts line', () => {
	function freshStatsDb(): Database.Database {
		const db = openDatabase(':memory:') as unknown as Database.Database;
		initializeSchema(db);
		return db;
	}

	function insertLogRow(db: Database.Database, source: 'compacted' | 'full' | 'none', n = 1) {
		for (let i = 0; i < n; i++) {
			db.prepare(`INSERT INTO session_search_log (session_id, query, source, match_count) VALUES (?, ?, ?, ?)`)
				.run('s1', 'needle', source, 0);
		}
	}

	it('renders the Session searches line with per-source counts given seeded rows across all 3 sources', () => {
		const db = freshStatsDb();
		insertLogRow(db, 'compacted', 2);
		insertLogRow(db, 'full', 3);
		insertLogRow(db, 'none', 1);

		const text = formatStats(getStats(db));

		expect(text).toContain('**Session searches:** 6 total (compacted: 2, full: 3, none: 1)');
		db.close();
	});

	it('zero-fills all 3 source keys as 0 when session_search_log is empty', () => {
		const db = freshStatsDb();

		const text = formatStats(getStats(db));

		expect(text).toContain('**Session searches:** 0 total (compacted: 0, full: 0, none: 0)');
		db.close();
	});

	it('leaves every pre-existing rendered line unchanged (regression)', () => {
		const db = freshStatsDb();
		insertLogRow(db, 'full', 1);

		const text = formatStats(getStats(db));

		expect(text).toContain('# Nexus Stats');
		expect(text).toMatch(/\*\*Total Atoms:\*\* \d+ \(\d+ embedded\)/);
		expect(text).toMatch(/\*\*By Type:\*\*/);
		expect(text).toMatch(/\*\*By Scope:\*\*/);
		expect(text).toMatch(/\*\*By Project:\*\*/);
		expect(text).toMatch(/\*\*Memories:\*\* \d+ \(\d+ embedded\) — review: /);
		expect(text).toMatch(/\*\*Links:\*\* \d+/);
		expect(text).toMatch(/\*\*Sessions:\*\* \d+/);
		expect(text).toMatch(/\*\*Diagnostics:\*\* \d+/);
		db.close();
	});
});
