import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase, initializeSchema } from './database.js';
import { detectContradictions, MAX_PAIRS_PER_RUN, type HaikuFn } from './governance.js';

// ── Test setup ────────────────────────────────────────────────────────
// Fresh in-memory DB per test, schema built via the project's real migration
// path (same convention as governance-helprate.test.ts).

function freshDb(): Database.Database {
	const db = openDatabase(':memory:');
	initializeSchema(db);
	return db;
}

const OLD_TIMESTAMP = '2020-01-01T00:00:00.000Z';

interface SeedOverrides {
	id: string;
	scope?: 'global' | 'shared' | 'project';
	project?: string | null;
	confidence?: number;
	decay_class?: 'stable' | 'architecture' | 'api_contract' | 'implementation';
	review_status?: 'pending' | 'approved' | 'rejected';
	superseded_by?: string | null;
}

// Seeds a memories row with sane defaults, overridable per test.
function seedMemory(db: Database.Database, o: SeedOverrides): string {
	db.prepare(`
		INSERT INTO memories (
			id, title, body, memory_type, scope, project, confidence, decay_class,
			last_verified_at, use_count, help_count, superseded_by, review_status,
			tags, content_hash, created_at, updated_at
		) VALUES (
			@id, @title, @body, 'insight', @scope, @project, @confidence, @decay_class,
			@last_verified_at, 0, 0, @superseded_by, @review_status,
			'[]', @content_hash, @created_at, @updated_at
		)
	`).run({
		id: o.id,
		title: `title-${o.id}`,
		body: `body-${o.id}`,
		scope: o.scope ?? 'project',
		project: o.project ?? 'projA',
		confidence: o.confidence ?? 0.6,
		decay_class: o.decay_class ?? 'implementation',
		last_verified_at: OLD_TIMESTAMP,
		superseded_by: o.superseded_by ?? null,
		review_status: o.review_status ?? 'approved',
		content_hash: `hash-${o.id}`,
		created_at: OLD_TIMESTAMP,
		updated_at: OLD_TIMESTAMP,
	});
	return o.id;
}

// Seeds a memory_links row. No FK on memory_links, so ids need not pre-exist,
// but tests always seed real memories first for realism.
function seedLink(db: Database.Database, sourceId: string, targetId: string, linkType: string, createdAt?: string): void {
	db.prepare(`
		INSERT INTO memory_links (source_id, target_id, link_type, confidence, created_at)
		VALUES (?, ?, ?, 1.0, ?)
	`).run(sourceId, targetId, linkType, createdAt ?? OLD_TIMESTAMP);
}

function countLinks(db: Database.Database, linkType: string): number {
	const row = db.prepare(`SELECT COUNT(*) AS c FROM memory_links WHERE link_type = ?`).get(linkType) as { c: number };
	return row.c;
}

function countDiagnostics(db: Database.Database): number {
	const row = db.prepare(`SELECT COUNT(*) AS c FROM diagnostics`).get() as { c: number };
	return row.c;
}

// ── Fake HaikuFn implementations ─────────────────────────────────────
// A recording fake captures every (systemPrompt, userPrompt) pair it was
// called with, in call order, so tests can assert exactly which pairs were
// shortlisted and in what order.

function makeRecordingFake(): { fn: HaikuFn; calls: Array<{ system: string; user: string }> } {
	const calls: Array<{ system: string; user: string }> = [];
	const fn: HaikuFn = async (system, user) => {
		calls.push({ system, user });
		return JSON.stringify({ conflict: false });
	};
	return { fn, calls };
}

function makeThrowingFake(): HaikuFn {
	return async () => {
		throw new Error('simulated haiku failure');
	};
}

function makeUnparseableFake(): HaikuFn {
	return async () => 'this is just some plain prose with no discernible json conflict field in it at all';
}

// Always reports a conflict, with a fixed reason string tests can assert on.
function makeConflictFake(reason = 'some reason'): HaikuFn {
	return async () => JSON.stringify({ conflict: true, reason });
}

function getContradictsLink(db: Database.Database, sourceId: string, targetId: string): { source_id: string; target_id: string } | undefined {
	return db.prepare(`
		SELECT source_id, target_id FROM memory_links
		WHERE link_type = 'contradicts' AND source_id = ? AND target_id = ?
	`).get(sourceId, targetId) as { source_id: string; target_id: string } | undefined;
}

function getStaleDiagnostics(db: Database.Database): Array<{ type: string; atom_id: string | null; message: string; details: string | null }> {
	return db.prepare(`SELECT type, atom_id, message, details FROM diagnostics WHERE type = 'stale'`).all() as Array<{ type: string; atom_id: string | null; message: string; details: string | null }>;
}

describe('detectContradictions — candidate selection', () => {
	it('shortlists a pair joined by an existing related memory_links row and calls haikuFn exactly once', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'a1', confidence: 0.9 });
		seedMemory(db, { id: 'a2', confidence: 0.5 });
		seedLink(db, 'a1', 'a2', 'related');

		const { fn, calls } = makeRecordingFake();
		await detectContradictions(db, fn);

		expect(calls.length).toBe(1);
		db.close();
	});

	it('excludes a related pair where one side is not review_status=approved (pending)', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'b1', confidence: 0.9 });
		seedMemory(db, { id: 'b2', confidence: 0.5, review_status: 'pending' });
		seedLink(db, 'b1', 'b2', 'related');

		const { fn, calls } = makeRecordingFake();
		await detectContradictions(db, fn);

		expect(calls.length).toBe(0);
		db.close();
	});

	it('excludes a related pair where one side has superseded_by set', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'winner-1', confidence: 0.6 });
		seedMemory(db, { id: 'c1', confidence: 0.9 });
		seedMemory(db, { id: 'c2', confidence: 0.5, superseded_by: 'winner-1' });
		seedLink(db, 'c1', 'c2', 'related');

		const { fn, calls } = makeRecordingFake();
		await detectContradictions(db, fn);

		expect(calls.length).toBe(0);
		db.close();
	});

	it('excludes a related pair with mismatched scope', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'd1', confidence: 0.9, scope: 'project' });
		seedMemory(db, { id: 'd2', confidence: 0.5, scope: 'global' });
		seedLink(db, 'd1', 'd2', 'related');

		const { fn, calls } = makeRecordingFake();
		await detectContradictions(db, fn);

		expect(calls.length).toBe(0);
		db.close();
	});

	it('excludes a related pair with mismatched project', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'e1', confidence: 0.9, project: 'projA' });
		seedMemory(db, { id: 'e2', confidence: 0.5, project: 'projB' });
		seedLink(db, 'e1', 'e2', 'related');

		const { fn, calls } = makeRecordingFake();
		await detectContradictions(db, fn);

		expect(calls.length).toBe(0);
		db.close();
	});

	it('excludes a related pair that is NOT divergent (same confidence, same decay_class)', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'f1', confidence: 0.6, decay_class: 'implementation' });
		seedMemory(db, { id: 'f2', confidence: 0.6, decay_class: 'implementation' });
		seedLink(db, 'f1', 'f2', 'related');

		const { fn, calls } = makeRecordingFake();
		await detectContradictions(db, fn);

		expect(calls.length).toBe(0);
		db.close();
	});

	it('includes a related pair that IS divergent by confidence gap > 0.3', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'g1', confidence: 0.9, decay_class: 'implementation' });
		seedMemory(db, { id: 'g2', confidence: 0.5, decay_class: 'implementation' });
		seedLink(db, 'g1', 'g2', 'related');

		const { fn, calls } = makeRecordingFake();
		await detectContradictions(db, fn);

		expect(calls.length).toBe(1);
		db.close();
	});

	it('includes a related pair that IS divergent by differing decay_class (confidence equal)', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'h1', confidence: 0.6, decay_class: 'stable' });
		seedMemory(db, { id: 'h2', confidence: 0.6, decay_class: 'implementation' });
		seedLink(db, 'h1', 'h2', 'related');

		const { fn, calls } = makeRecordingFake();
		await detectContradictions(db, fn);

		expect(calls.length).toBe(1);
		db.close();
	});

	it('excludes a divergent related pair that already has an existing contradicts link (source->target)', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'i1', confidence: 0.9 });
		seedMemory(db, { id: 'i2', confidence: 0.5 });
		seedLink(db, 'i1', 'i2', 'related');
		seedLink(db, 'i1', 'i2', 'contradicts');

		const { fn, calls } = makeRecordingFake();
		await detectContradictions(db, fn);

		expect(calls.length).toBe(0);
		db.close();
	});

	it('excludes a divergent related pair that already has an existing contradicts link (reverse direction)', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'j1', confidence: 0.9 });
		seedMemory(db, { id: 'j2', confidence: 0.5 });
		seedLink(db, 'j1', 'j2', 'related');
		seedLink(db, 'j2', 'j1', 'contradicts');

		const { fn, calls } = makeRecordingFake();
		await detectContradictions(db, fn);

		expect(calls.length).toBe(0);
		db.close();
	});

	it('processes shortlisted pairs in ascending order of the related link created_at', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'k1', confidence: 0.9 });
		seedMemory(db, { id: 'k2', confidence: 0.5 });
		seedMemory(db, { id: 'k3', confidence: 0.9 });
		seedMemory(db, { id: 'k4', confidence: 0.5 });
		seedMemory(db, { id: 'k5', confidence: 0.9 });
		seedMemory(db, { id: 'k6', confidence: 0.5 });

		// Seeded out of chronological order to prove ordering is by created_at,
		// not by insertion / row-id order.
		seedLink(db, 'k5', 'k6', 'related', '2023-03-01T00:00:00.000Z');
		seedLink(db, 'k1', 'k2', 'related', '2023-01-01T00:00:00.000Z');
		seedLink(db, 'k3', 'k4', 'related', '2023-02-01T00:00:00.000Z');

		const { fn, calls } = makeRecordingFake();
		await detectContradictions(db, fn);

		expect(calls.length).toBe(3);
		expect(calls[0].user).toContain('k1');
		expect(calls[0].user).toContain('k2');
		expect(calls[1].user).toContain('k3');
		expect(calls[1].user).toContain('k4');
		expect(calls[2].user).toContain('k5');
		expect(calls[2].user).toContain('k6');
		db.close();
	});

	it('caps candidates at MAX_PAIRS_PER_RUN and reports contradictionPairsChecked accordingly', async () => {
		const db = freshDb();
		const total = MAX_PAIRS_PER_RUN + 5;
		for (let i = 0; i < total; i++) {
			const aId = `cap-a${i}`;
			const bId = `cap-b${i}`;
			const proj = `capProj${i}`;
			seedMemory(db, { id: aId, confidence: 0.9, project: proj });
			seedMemory(db, { id: bId, confidence: 0.5, project: proj });
			seedLink(db, aId, bId, 'related', `2023-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`);
		}

		const { fn, calls } = makeRecordingFake();
		const result = await detectContradictions(db, fn);

		expect(calls.length).toBeLessThanOrEqual(MAX_PAIRS_PER_RUN);
		expect(result.contradictionPairsChecked).toBe(MAX_PAIRS_PER_RUN);
		db.close();
	});

	it('contradictionPairsChecked counts attempted pairs even when haikuFn throws for all of them', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'att-a1', confidence: 0.9 });
		seedMemory(db, { id: 'att-b1', confidence: 0.5 });
		seedLink(db, 'att-a1', 'att-b1', 'related');

		seedMemory(db, { id: 'att-a2', confidence: 0.9 });
		seedMemory(db, { id: 'att-b2', confidence: 0.5 });
		seedLink(db, 'att-a2', 'att-b2', 'related');

		const throwingFake = makeThrowingFake();
		const result = await detectContradictions(db, throwingFake);

		expect(result.contradictionPairsChecked).toBe(2);
		expect(result.contradictionsFlagged).toBe(0);
		db.close();
	});

	it('skip-on-failure: resolves (does not reject) and writes nothing when haikuFn throws for a shortlisted pair', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'thr-a', confidence: 0.9 });
		seedMemory(db, { id: 'thr-b', confidence: 0.5 });
		seedLink(db, 'thr-a', 'thr-b', 'related');

		const throwingFake = makeThrowingFake();

		await expect(detectContradictions(db, throwingFake)).resolves.toBeDefined();

		expect(countLinks(db, 'contradicts')).toBe(0);
		expect(countDiagnostics(db)).toBe(0);
		db.close();
	});

	it('skip-on-failure: resolves (does not reject) and writes nothing when haikuFn returns unparseable text', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'unp-a', confidence: 0.9 });
		seedMemory(db, { id: 'unp-b', confidence: 0.5 });
		seedLink(db, 'unp-a', 'unp-b', 'related');

		const unparseableFake = makeUnparseableFake();

		await expect(detectContradictions(db, unparseableFake)).resolves.toBeDefined();

		expect(countLinks(db, 'contradicts')).toBe(0);
		expect(countDiagnostics(db)).toBe(0);
		db.close();
	});
});

describe('detectContradictions — confirmed writes', () => {
	it('writes bidirectional contradicts links and one stale diagnostic when haikuFn confirms a conflict', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'conf-a', confidence: 0.9 });
		seedMemory(db, { id: 'conf-b', confidence: 0.5 });
		seedLink(db, 'conf-a', 'conf-b', 'related');

		const conflictFake = makeConflictFake('some reason');
		const result = await detectContradictions(db, conflictFake);

		expect(countLinks(db, 'contradicts')).toBe(2);
		expect(getContradictsLink(db, 'conf-a', 'conf-b')).toBeDefined();
		expect(getContradictsLink(db, 'conf-b', 'conf-a')).toBeDefined();

		const diagnostics = getStaleDiagnostics(db);
		expect(diagnostics.length).toBe(1);
		const diag = diagnostics[0];
		expect(diag.atom_id).toBeNull();
		expect(diag.message).toContain('Contradiction candidate:');
		expect(diag.message).toContain('title-conf-a');
		expect(diag.message).toContain('title-conf-b');

		expect(diag.details).toBeTruthy();
		const details = JSON.parse(diag.details as string) as { reason: string; memory_ids: string[]; haiku_reason: string };
		expect(details.reason).toBe('contradiction');
		expect([...details.memory_ids].sort()).toEqual(['conf-a', 'conf-b'].sort());
		expect(details.haiku_reason).toBe('some reason');

		expect(result.contradictionsFlagged).toBe(1);
		db.close();
	});

	it('is idempotent: running twice does not create duplicate links or diagnostics', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'idem-a', confidence: 0.9 });
		seedMemory(db, { id: 'idem-b', confidence: 0.5 });
		seedLink(db, 'idem-a', 'idem-b', 'related');

		const conflictFake = makeConflictFake('idempotency reason');

		await detectContradictions(db, conflictFake);
		expect(countLinks(db, 'contradicts')).toBe(2);
		expect(countDiagnostics(db)).toBe(1);

		// Second run: the pair is already linked 'contradicts', so per the
		// task-007 shortlist exclusion it won't be re-shortlisted at all.
		// Final state after 2 runs must match the state after 1 run.
		await detectContradictions(db, conflictFake);
		expect(countLinks(db, 'contradicts')).toBe(2);
		expect(countDiagnostics(db)).toBe(1);
		expect(getContradictsLink(db, 'idem-a', 'idem-b')).toBeDefined();
		expect(getContradictsLink(db, 'idem-b', 'idem-a')).toBeDefined();

		db.close();
	});

	it('writes nothing when haikuFn reports conflict=false', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'noconf-a', confidence: 0.9 });
		seedMemory(db, { id: 'noconf-b', confidence: 0.5 });
		seedLink(db, 'noconf-a', 'noconf-b', 'related');

		const { fn } = makeRecordingFake(); // always returns conflict: false
		await detectContradictions(db, fn);

		expect(countLinks(db, 'contradicts')).toBe(0);
		expect(countDiagnostics(db)).toBe(0);
		db.close();
	});
});

describe('detectContradictions — self-heal diagnostic re-derivation', () => {
	// Simulates decay.ts:flagStaleMemories wiping all 'stale' diagnostics
	// (raw DELETE, as it really does) without importing decay.ts at all.
	function wipeStaleDiagnostics(db: Database.Database): void {
		db.exec(`DELETE FROM diagnostics WHERE type = 'stale'`);
	}

	it('re-derives exactly one stale diagnostic for an existing contradicts pair whose diagnostic was wiped, without calling haikuFn', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'heal-a', confidence: 0.9 });
		seedMemory(db, { id: 'heal-b', confidence: 0.5 });
		// Simulate a pair already confirmed as contradicting in some prior run:
		// bidirectional 'contradicts' links seeded directly, no 'related' link.
		seedLink(db, 'heal-a', 'heal-b', 'contradicts');
		seedLink(db, 'heal-b', 'heal-a', 'contradicts');

		// No matching diagnostic exists yet — simulate the wipe explicitly anyway
		// to mirror production sequencing (wipe happens, then detection runs).
		wipeStaleDiagnostics(db);
		expect(countDiagnostics(db)).toBe(0);

		const throwingFake = makeThrowingFake(); // must NOT be invoked for an already-contradicts pair

		await detectContradictions(db, throwingFake);

		const diagnostics = getStaleDiagnostics(db);
		expect(diagnostics.length).toBe(1);
		const diag = diagnostics[0];
		expect(diag.atom_id).toBeNull();
		expect(diag.message).toContain('Contradiction candidate:');
		expect(diag.message).toContain('title-heal-a');
		expect(diag.message).toContain('title-heal-b');

		expect(diag.details).toBeTruthy();
		const details = JSON.parse(diag.details as string) as { reason: string; memory_ids: string[] };
		expect(details.reason).toBe('contradiction');
		expect([...details.memory_ids].sort()).toEqual(['heal-a', 'heal-b'].sort());

		db.close();
	});

	it('is idempotent: running detectContradictions a second time after re-derivation adds no additional diagnostics', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'heal2-a', confidence: 0.9 });
		seedMemory(db, { id: 'heal2-b', confidence: 0.5 });
		seedLink(db, 'heal2-a', 'heal2-b', 'contradicts');
		seedLink(db, 'heal2-b', 'heal2-a', 'contradicts');
		wipeStaleDiagnostics(db);

		const throwingFake = makeThrowingFake();

		await detectContradictions(db, throwingFake);
		expect(getStaleDiagnostics(db).length).toBe(1);

		// Second run: diagnostic now present, self-heal must be a no-op.
		await detectContradictions(db, throwingFake);
		expect(getStaleDiagnostics(db).length).toBe(1);

		db.close();
	});

	it('leaves an already-contradicts pair alone when its diagnostic was never wiped (no duplicate)', async () => {
		const db = freshDb();
		seedMemory(db, { id: 'heal3-a', confidence: 0.9 });
		seedMemory(db, { id: 'heal3-b', confidence: 0.5 });
		seedLink(db, 'heal3-a', 'heal3-b', 'contradicts');
		seedLink(db, 'heal3-b', 'heal3-a', 'contradicts');

		// Seed the matching diagnostic directly, as if it was never wiped.
		db.prepare(`
			INSERT INTO diagnostics (type, atom_id, message, details, created_at)
			VALUES ('stale', NULL, ?, ?, ?)
		`).run(
			`Contradiction candidate: "title-heal3-a" vs "title-heal3-b"`,
			JSON.stringify({ reason: 'contradiction', memory_ids: ['heal3-a', 'heal3-b'], haiku_reason: 'pre-existing' }),
			OLD_TIMESTAMP,
		);
		expect(countDiagnostics(db)).toBe(1);

		const throwingFake = makeThrowingFake();
		await detectContradictions(db, throwingFake);

		expect(getStaleDiagnostics(db).length).toBe(1);
		db.close();
	});
});
