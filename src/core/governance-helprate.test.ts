import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase, initializeSchema } from './database.js';
import { governByHelpRate } from './governance.js';

// ── Test setup ────────────────────────────────────────────────────────
// Fresh in-memory DB per test, schema built via the project's real migration
// path (same convention as database.test.ts / recall.test.ts).

function freshDb(): Database.Database {
	const db = openDatabase(':memory:');
	initializeSchema(db);
	return db;
}

const OLD_TIMESTAMP = '2020-01-01T00:00:00.000Z';

interface MemoryRow {
	id: string;
	title: string;
	body: string;
	memory_type: string;
	scope: string;
	project: string | null;
	confidence: number;
	decay_class: string;
	last_verified_at: string;
	use_count: number;
	help_count: number;
	superseded_by: string | null;
	review_status: string;
	tags: string;
	content_hash: string;
	created_at: string;
	updated_at: string;
}

interface SeedOverrides {
	id: string;
	confidence?: number;
	use_count?: number;
	help_count?: number;
	review_status?: 'pending' | 'approved' | 'rejected';
	superseded_by?: string | null;
	last_verified_at?: string;
	updated_at?: string;
}

// Seeds a memories row with sane defaults, overridable per test. Returns the
// id for convenience so callers can fetch it back after governByHelpRate runs.
function seedMemory(db: Database.Database, o: SeedOverrides): string {
	db.prepare(`
		INSERT INTO memories (
			id, title, body, memory_type, scope, project, confidence, decay_class,
			last_verified_at, use_count, help_count, superseded_by, review_status,
			tags, content_hash, created_at, updated_at
		) VALUES (
			@id, @title, @body, 'insight', 'project', 'projA', @confidence, 'implementation',
			@last_verified_at, @use_count, @help_count, @superseded_by, @review_status,
			'[]', @content_hash, @created_at, @updated_at
		)
	`).run({
		id: o.id,
		title: `title-${o.id}`,
		body: `body-${o.id}`,
		confidence: o.confidence ?? 0.6,
		last_verified_at: o.last_verified_at ?? OLD_TIMESTAMP,
		use_count: o.use_count ?? 0,
		help_count: o.help_count ?? 0,
		superseded_by: o.superseded_by ?? null,
		review_status: o.review_status ?? 'approved',
		content_hash: `hash-${o.id}`,
		created_at: OLD_TIMESTAMP,
		updated_at: o.updated_at ?? OLD_TIMESTAMP,
	});
	return o.id;
}

function getMemory(db: Database.Database, id: string): MemoryRow {
	return db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as MemoryRow;
}

describe('governByHelpRate', () => {
	it('demotes a memory with use_count>=5 and helpRate < 0.3: confidence*0.85 floored, counts reset, last_verified_at unchanged', () => {
		const db = freshDb();
		seedMemory(db, { id: 'demote-1', confidence: 0.6, use_count: 10, help_count: 2, last_verified_at: OLD_TIMESTAMP });

		const result = governByHelpRate(db);

		const row = getMemory(db, 'demote-1');
		expect(row.confidence).toBeCloseTo(Math.max(0.1, 0.6 * 0.85), 5);
		expect(row.use_count).toBe(0);
		expect(row.help_count).toBe(0);
		expect(row.last_verified_at).toBe(OLD_TIMESTAMP);
		expect(result.demoted).toBe(1);
		db.close();
	});

	it('reinforces a memory with use_count>=5 and helpRate > 0.8: confidence+0.05 capped, counts reset, last_verified_at refreshed', () => {
		const db = freshDb();
		seedMemory(db, { id: 'reinforce-1', confidence: 0.6, use_count: 10, help_count: 9, last_verified_at: OLD_TIMESTAMP });

		const result = governByHelpRate(db);

		const row = getMemory(db, 'reinforce-1');
		expect(row.confidence).toBeCloseTo(Math.min(1.0, 0.6 + 0.05), 5);
		expect(row.use_count).toBe(0);
		expect(row.help_count).toBe(0);
		expect(row.last_verified_at).not.toBe(OLD_TIMESTAMP);
		expect(result.reinforced).toBe(1);
		db.close();
	});

	it('dead zone (0.3 < helpRate < 0.8): resets counts and touches updated_at, but leaves confidence and last_verified_at unchanged', () => {
		const db = freshDb();
		seedMemory(db, {
			id: 'deadzone-1', confidence: 0.6, use_count: 10, help_count: 5,
			last_verified_at: OLD_TIMESTAMP, updated_at: OLD_TIMESTAMP,
		});

		const result = governByHelpRate(db);

		const row = getMemory(db, 'deadzone-1');
		expect(row.use_count).toBe(0);
		expect(row.help_count).toBe(0);
		expect(row.updated_at).not.toBe(OLD_TIMESTAMP);
		expect(row.confidence).toBeCloseTo(0.6, 5);
		expect(row.last_verified_at).toBe(OLD_TIMESTAMP);
		expect(result.demoted).toBe(0);
		expect(result.reinforced).toBe(0);
		db.close();
	});

	it('below MIN_EVALUATIONS (use_count < 5): row is completely untouched', () => {
		const db = freshDb();
		seedMemory(db, {
			id: 'below-min-1', confidence: 0.6, use_count: 4, help_count: 1,
			last_verified_at: OLD_TIMESTAMP, updated_at: OLD_TIMESTAMP,
		});
		const before = getMemory(db, 'below-min-1');

		const result = governByHelpRate(db);

		const after = getMemory(db, 'below-min-1');
		expect(after.confidence).toBe(before.confidence);
		expect(after.use_count).toBe(before.use_count);
		expect(after.help_count).toBe(before.help_count);
		expect(after.last_verified_at).toBe(before.last_verified_at);
		expect(after.updated_at).toBe(before.updated_at);
		expect(result.demoted).toBe(0);
		expect(result.reinforced).toBe(0);
		db.close();
	});

	it('use_count exactly at MIN_EVALUATIONS (5) is evaluated (edge case, >= not >)', () => {
		const db = freshDb();
		// rate 0/5 = 0 < 0.3 -> demote branch
		seedMemory(db, { id: 'exactly-min-1', confidence: 0.6, use_count: 5, help_count: 0, last_verified_at: OLD_TIMESTAMP });

		const result = governByHelpRate(db);

		const row = getMemory(db, 'exactly-min-1');
		expect(row.confidence).toBeCloseTo(Math.max(0.1, 0.6 * 0.85), 5);
		expect(row.use_count).toBe(0);
		expect(row.help_count).toBe(0);
		expect(result.demoted).toBe(1);
		db.close();
	});

	it('floor clamp: a demote candidate near confidence=0.1 never goes below 0.1', () => {
		const db = freshDb();
		seedMemory(db, { id: 'floor-1', confidence: 0.11, use_count: 10, help_count: 0, last_verified_at: OLD_TIMESTAMP });

		governByHelpRate(db);

		const row = getMemory(db, 'floor-1');
		expect(row.confidence).toBeGreaterThanOrEqual(0.1);
		expect(row.confidence).toBeCloseTo(0.1, 5);
		db.close();
	});

	it('cap clamp: a reinforce candidate near confidence=1.0 never exceeds 1.0', () => {
		const db = freshDb();
		seedMemory(db, { id: 'cap-1', confidence: 0.98, use_count: 10, help_count: 10, last_verified_at: OLD_TIMESTAMP });

		governByHelpRate(db);

		const row = getMemory(db, 'cap-1');
		expect(row.confidence).toBeLessThanOrEqual(1.0);
		expect(row.confidence).toBeCloseTo(1.0, 5);
		db.close();
	});

	it('only considers review_status=approved AND superseded_by IS NULL: pending and superseded rows are skipped and not counted', () => {
		const db = freshDb();
		// Would-be demote if it were approved
		seedMemory(db, {
			id: 'pending-1', confidence: 0.6, use_count: 10, help_count: 0,
			review_status: 'pending', last_verified_at: OLD_TIMESTAMP,
		});
		// Would-be reinforce if it weren't superseded. superseded_by has an FK to
		// memories(id), so the winner row must exist first.
		seedMemory(db, { id: 'some-other-id', confidence: 0.6, use_count: 0, help_count: 0 });
		seedMemory(db, {
			id: 'superseded-1', confidence: 0.6, use_count: 10, help_count: 10,
			review_status: 'approved', superseded_by: 'some-other-id', last_verified_at: OLD_TIMESTAMP,
		});

		const result = governByHelpRate(db);

		const pending = getMemory(db, 'pending-1');
		const superseded = getMemory(db, 'superseded-1');
		expect(pending.confidence).toBeCloseTo(0.6, 5);
		expect(pending.use_count).toBe(10);
		expect(pending.help_count).toBe(0);
		expect(superseded.confidence).toBeCloseTo(0.6, 5);
		expect(superseded.use_count).toBe(10);
		expect(superseded.help_count).toBe(10);
		expect(result.demoted).toBe(0);
		expect(result.reinforced).toBe(0);
		db.close();
	});

	it('writes a diagnostics row (type=stale, reason=low_help_rate) for a demoted memory, with old/new confidence in details', () => {
		const db = freshDb();
		seedMemory(db, { id: 'demote-diag-1', confidence: 0.6, use_count: 10, help_count: 2, last_verified_at: OLD_TIMESTAMP });

		governByHelpRate(db);

		const rows = db.prepare(`SELECT * FROM diagnostics WHERE type = 'stale'`).all() as {
			atom_id: string | null; message: string; details: string;
		}[];
		expect(rows.length).toBe(1);
		expect(rows[0].atom_id).toBeNull();
		expect(rows[0].message).toContain('title-demote-diag-1');
		const details = JSON.parse(rows[0].details) as {
			reason: string; memory_id: string; old_confidence: number; new_confidence: number;
		};
		expect(details.reason).toBe('low_help_rate');
		expect(details.memory_id).toBe('demote-diag-1');
		expect(details.old_confidence).toBeCloseTo(0.6, 5);
		expect(details.new_confidence).toBeCloseTo(Math.max(0.1, 0.6 * 0.85), 5);
		db.close();
	});

	it('does not write a diagnostics row for reinforced or dead-zone memories', () => {
		const db = freshDb();
		seedMemory(db, { id: 'reinforce-diag-1', confidence: 0.6, use_count: 10, help_count: 9, last_verified_at: OLD_TIMESTAMP });
		seedMemory(db, { id: 'deadzone-diag-1', confidence: 0.6, use_count: 10, help_count: 5, last_verified_at: OLD_TIMESTAMP });

		governByHelpRate(db);

		const rows = db.prepare(`SELECT * FROM diagnostics WHERE type = 'stale'`).all();
		expect(rows.length).toBe(0);
		db.close();
	});

	it('returns { demoted, reinforced } counts matching the branch outcomes across a mixed seeded set', () => {
		const db = freshDb();
		seedMemory(db, { id: 'mix-demote', confidence: 0.6, use_count: 10, help_count: 1, last_verified_at: OLD_TIMESTAMP }); // rate 0.1 -> demote
		seedMemory(db, { id: 'mix-reinforce', confidence: 0.6, use_count: 10, help_count: 9, last_verified_at: OLD_TIMESTAMP }); // rate 0.9 -> reinforce
		seedMemory(db, { id: 'mix-deadzone', confidence: 0.6, use_count: 10, help_count: 5, last_verified_at: OLD_TIMESTAMP }); // rate 0.5 -> dead zone
		seedMemory(db, { id: 'mix-below', confidence: 0.6, use_count: 3, help_count: 1, last_verified_at: OLD_TIMESTAMP }); // below MIN_EVALUATIONS

		const result = governByHelpRate(db);

		expect(result).toEqual({ demoted: 1, reinforced: 1 });
		db.close();
	});
});
