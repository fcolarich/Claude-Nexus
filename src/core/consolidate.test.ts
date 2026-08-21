// End-to-end integration test for consolidateMemories — exercises all five
// phases (backfill embeddings, prune rejected, merge near-dups, govern by
// help-rate, detect contradictions) together against a real schema-migrated
// in-memory DB. Unit-level behavior for phases 4/5 is already covered by
// governance-helprate.test.ts and governance-contradictions.test.ts; this file
// only asserts the aggregate outcome of running them in sequence.
//
// NOTE: this file never imports decay.ts. The self-heal test below simulates
// decay.ts:flagStaleMemories's raw `DELETE FROM diagnostics WHERE type='stale'`
// wipe directly, without importing decay.ts at all (task-015 requirement).

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase, initializeSchema } from './database.js';
import { consolidateMemories } from './consolidate.js';
import type { HaikuFn } from './governance.js';

// ── Test setup ────────────────────────────────────────────────────────

function freshDb(): Database.Database {
	const db = openDatabase(':memory:');
	initializeSchema(db);
	return db;
}

const OLD_TIMESTAMP = '2020-01-01T00:00:00.000Z';

// Distinct bodies containing this marker get an IDENTICAL fake embedding
// vector regardless of their exact text — guarantees cosine similarity = 1.0
// between them, which always exceeds any reasonable dedup threshold.
const DUP_MARKER = 'DUPMARK';

// Stub for confirmDuplicateFn — the gate always runs now, so tests exercising
// the raw-cosine merge itself (unrelated to claim-level confirmation, covered
// separately in lifecycle.test.ts) stub it to "confirmed" to keep the merge
// unblocked.
const confirmedGuard = async () => 'confirmed' as const;

interface SeedOverrides {
	id: string;
	title?: string;
	body?: string;
	scope?: 'global' | 'shared' | 'project';
	project?: string | null;
	confidence?: number;
	decay_class?: 'stable' | 'architecture' | 'api_contract' | 'implementation';
	use_count?: number;
	help_count?: number;
	review_status?: 'pending' | 'approved' | 'rejected';
	superseded_by?: string | null;
}

function seedMemory(db: Database.Database, o: SeedOverrides): string {
	db.prepare(`
		INSERT INTO memories (
			id, title, body, memory_type, scope, project, confidence, decay_class,
			last_verified_at, use_count, help_count, superseded_by, review_status,
			tags, content_hash, created_at, updated_at
		) VALUES (
			@id, @title, @body, 'insight', @scope, @project, @confidence, @decay_class,
			@last_verified_at, @use_count, @help_count, @superseded_by, @review_status,
			'[]', @content_hash, @created_at, @updated_at
		)
	`).run({
		id: o.id,
		title: o.title ?? `title-${o.id}`,
		body: o.body ?? `body-${o.id}`,
		scope: o.scope ?? 'project',
		project: o.project ?? 'projA',
		confidence: o.confidence ?? 0.6,
		decay_class: o.decay_class ?? 'implementation',
		last_verified_at: OLD_TIMESTAMP,
		use_count: o.use_count ?? 0,
		help_count: o.help_count ?? 0,
		superseded_by: o.superseded_by ?? null,
		review_status: o.review_status ?? 'approved',
		content_hash: `hash-${o.id}`,
		created_at: OLD_TIMESTAMP,
		updated_at: OLD_TIMESTAMP,
	});
	return o.id;
}

function seedLink(db: Database.Database, sourceId: string, targetId: string, linkType: string): void {
	db.prepare(`
		INSERT INTO memory_links (source_id, target_id, link_type, confidence, created_at)
		VALUES (?, ?, ?, 1.0, ?)
	`).run(sourceId, targetId, linkType, OLD_TIMESTAMP);
}

function getMemory(db: Database.Database, id: string): Record<string, unknown> | undefined {
	return db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
}

function countDiagnostics(db: Database.Database, type: string): number {
	const row = db.prepare(`SELECT COUNT(*) AS c FROM diagnostics WHERE type = ?`).get(type) as { c: number };
	return row.c;
}

// ── Fake embedFn ──────────────────────────────────────────────────────
// Deterministic pseudo-random unit-ish vector per input text, EXCEPT any
// text containing DUP_MARKER always maps to the same fixed vector — this
// is what forces the "near-duplicate" pair to cross the merge threshold.
// Real, distinct texts hash to effectively-orthogonal 1024-dim vectors, so
// they never accidentally cross the dedup threshold with each other.

function seededVector(seed: string): Float32Array {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	const v = new Float32Array(1024);
	let x = (h >>> 0) || 1;
	for (let i = 0; i < 1024; i++) {
		x = (Math.imul(x, 1103515245) + 12345) >>> 0;
		v[i] = (x / 0xffffffff) * 2 - 1;
	}
	return v;
}

async function fakeEmbedFn(text: string): Promise<Float32Array | null> {
	if (text.includes(DUP_MARKER)) return seededVector('fixed-dup-vector');
	return seededVector(text);
}

// ── Fake haikuFn ──────────────────────────────────────────────────────

function makeConflictFake(reason = 'divergent facts'): HaikuFn {
	return async () => JSON.stringify({ conflict: true, reason });
}

function makeThrowingFake(): HaikuFn {
	return async () => {
		throw new Error('simulated haiku failure — must not be called for an already-contradicts pair');
	};
}

describe('consolidateMemories', () => {
	it('runs all five phases and returns aggregated counts matching the seeded scenario', async () => {
		const db = freshDb();

		// 1 & 2: a rejected memory — gets embedded in phase 1 (embedUnindexedMemories
		// does not filter by review_status), then pruned in phase 2.
		seedMemory(db, { id: 'reject-1', review_status: 'rejected', project: 'projReject' });

		// 3: near-duplicate pair — identical fake embeddings via DUP_MARKER, kept in
		// their own project so they can't interfere with the other groups.
		seedMemory(db, {
			id: 'dup-a', project: 'projDup', confidence: 0.9,
			title: `dup title a ${DUP_MARKER}`, body: `dup body a ${DUP_MARKER}`,
		});
		seedMemory(db, {
			id: 'dup-b', project: 'projDup', confidence: 0.5,
			title: `dup title b ${DUP_MARKER}`, body: `dup body b ${DUP_MARKER}`,
		});

		// 4a: demotion candidate — use_count>=5, low help-rate, approved, non-superseded.
		seedMemory(db, { id: 'demote-1', project: 'projGovern', confidence: 0.6, use_count: 10, help_count: 1 });

		// 4b: reinforcement candidate — use_count>=5, high help-rate, approved, non-superseded.
		seedMemory(db, { id: 'reinforce-1', project: 'projGovern', confidence: 0.6, use_count: 10, help_count: 9 });

		// 5: 'related'-linked, divergent (confidence gap > 0.3), approved, same
		// scope/project pair for contradiction detection.
		seedMemory(db, { id: 'contra-a', project: 'projContra', confidence: 0.9 });
		seedMemory(db, { id: 'contra-b', project: 'projContra', confidence: 0.5 });
		seedLink(db, 'contra-a', 'contra-b', 'related');

		const conflictFake = makeConflictFake('some reason');
		const result = await consolidateMemories(db, fakeEmbedFn, conflictFake, confirmedGuard);

		// Aggregate outcome — implies phase order was followed (e.g. the pruned
		// memory never reaches governance or dedup).
		expect(result.embedded).toBe(7);
		expect(result.pruned).toBe(1);
		expect(result.merged).toBe(1);
		expect(result.demoted).toBe(1);
		expect(result.reinforced).toBe(1);
		expect(result.contradictionsFlagged).toBe(1);
		expect(result.contradictionPairsChecked).toBe(1);

		// Order-sensitivity: the rejected memory (pruned in phase 2) must be gone
		// entirely, not merely excluded from governance/dedup counts.
		expect(getMemory(db, 'reject-1')).toBeUndefined();

		// Dedup outcome: higher-confidence dup-a survives, dup-b is superseded.
		const dupA = getMemory(db, 'dup-a');
		const dupB = getMemory(db, 'dup-b');
		expect(dupA?.superseded_by).toBeNull();
		expect(dupB?.superseded_by).toBe('dup-a');

		// Governance outcome.
		const demote = getMemory(db, 'demote-1');
		const reinforce = getMemory(db, 'reinforce-1');
		expect(demote?.confidence).toBeCloseTo(Math.max(0.1, 0.6 * 0.85), 5);
		expect(reinforce?.confidence).toBeCloseTo(Math.min(1.0, 0.6 + 0.05), 5);

		// Contradiction outcome: bidirectional 'contradicts' links + one 'stale' diagnostic.
		const contradicts = db.prepare(
			`SELECT COUNT(*) AS c FROM memory_links WHERE link_type = 'contradicts'`
		).get() as { c: number };
		expect(contradicts.c).toBe(2);
		// 'stale' is a reused diagnostics type: one row from the confirmed
		// contradiction (phase 5) and one from the demotion (phase 4).
		expect(countDiagnostics(db, 'stale')).toBe(2);

		db.close();
	});

	it('self-heals a wiped contradiction diagnostic on the next run without calling haikuFn', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'heal-a', project: 'projHeal', confidence: 0.9 });
		seedMemory(db, { id: 'heal-b', project: 'projHeal', confidence: 0.5 });
		seedLink(db, 'heal-a', 'heal-b', 'related');

		// First run confirms the contradiction and writes its diagnostic.
		const first = await consolidateMemories(db, fakeEmbedFn, makeConflictFake());
		expect(first.contradictionsFlagged).toBe(1);
		expect(countDiagnostics(db, 'stale')).toBe(1);

		// Simulate decay.ts:flagStaleMemories's raw wipe of all 'stale' diagnostics.
		// decay.ts is never imported here — this is a direct SQL simulation.
		db.exec(`DELETE FROM diagnostics WHERE type = 'stale'`);
		expect(countDiagnostics(db, 'stale')).toBe(0);

		// Second run: the pair is already 'contradicts'-linked, so it's excluded
		// from re-shortlisting — a throwing haikuFn proves it's never called —
		// but self-heal re-derives the missing diagnostic regardless.
		const second = await consolidateMemories(db, fakeEmbedFn, makeThrowingFake());
		expect(countDiagnostics(db, 'stale')).toBe(1);
		expect(second.contradictionPairsChecked).toBe(0);
		expect(second.contradictionsFlagged).toBe(0);

		db.close();
	});

	it('has no schema drift in the tables consolidateMemories touches', () => {
		const db = freshDb();

		// memories: exact column set, order-independent (snapshot-style check).
		const memoriesCols = (db.prepare(`PRAGMA table_info('memories')`).all() as { name: string }[])
			.map((r) => r.name).sort();
		expect(memoriesCols).toEqual([
			'body', 'confidence', 'content_hash', 'created_at', 'decay_class',
			'discovered_from', 'help_count', 'id', 'last_verified_at', 'linked_at',
			'memory_type', 'project', 'promoted_to', 'promotion_target', 'review_status',
			'scope', 'source_session_id', 'superseded_by', 'tags', 'title', 'updated_at',
			'use_count', 'load_at_init', 'distilled_at', 'identifiers', 'claims_extracted_at',
		].sort());

		// Extracts the quoted value list from a `CHECK(<column> IN (...))` clause
		// only — not the whole CREATE TABLE SQL, which also contains unrelated
		// quoted strings like `datetime('now')` defaults.
		function checkValues(sql: string, column: string): string[] {
			const m = sql.match(new RegExp(`CHECK\\(${column}\\s+IN\\s*\\(([^)]*)\\)\\)`, 's'));
			if (!m) throw new Error(`no CHECK(${column} IN (...)) clause found`);
			return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
		}

		// memory_links: link_type CHECK contains exactly the 7 known values (order-independent).
		const linksSql = (db.prepare(
			`SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_links'`
		).get() as { sql: string }).sql;
		expect(checkValues(linksSql, 'link_type')).toEqual(
			['references', 'extends', 'refines', 'contradicts', 'supports', 'duplicates', 'related', 'same_as', 'supersedes'].sort()
		);

		// diagnostics: type CHECK contains exactly the 5 known values (order-independent).
		const diagSql = (db.prepare(
			`SELECT sql FROM sqlite_master WHERE type='table' AND name='diagnostics'`
		).get() as { sql: string }).sql;
		expect(checkValues(diagSql, 'type')).toEqual(
			['broken_reference', 'missing_frontmatter', 'duplicate', 'orphan', 'stale'].sort()
		);

		db.close();
	});
});
