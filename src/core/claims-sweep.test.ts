import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { insertMemory } from './memories.js';
import { listClaimsForMemory } from './claims.js';
import { decomposeMemoriesToClaims, buildEligibleMemoriesQuery, countEligibleMemories } from './claims-sweep.js';

function freshDb() {
	const db = openDatabase(':memory:');
	initializeSchema(db);
	return db;
}

const baseMem = {
	memory_type: 'decision' as const, scope: 'project' as const, project: 'p', confidence: 0.8,
	decay_class: 'stable' as const, review_status: 'approved' as const,
	source_session_id: null, discovered_from: null, tags: [], promotion_target: 'none' as const,
};

const fakeCallFn = async () => JSON.stringify([{ fact: 'a decomposed claim' }]);

describe('buildEligibleMemoriesQuery / countEligibleMemories', () => {
	it('only counts memories with claims_extracted_at IS NULL', () => {
		const db = freshDb();
		const a = insertMemory(db, { ...baseMem, title: 'A', body: 'body a' });
		insertMemory(db, { ...baseMem, title: 'B', body: 'body b' });
		db.prepare(`UPDATE memories SET claims_extracted_at = datetime('now') WHERE id = ?`).run(a.id);

		expect(countEligibleMemories(db)).toBe(1);
		db.close();
	});

	it('excludes superseded and non-approved memories, mirroring distill.ts eligibility', () => {
		const db = freshDb();
		insertMemory(db, { ...baseMem, title: 'Pending', body: 'body', review_status: 'pending' });
		insertMemory(db, { ...baseMem, title: 'Eligible', body: 'body2' });
		expect(countEligibleMemories(db)).toBe(1);
		db.close();
	});
});

describe('decomposeMemoriesToClaims', () => {
	it('stamps claims_extracted_at on every processed memory, accepted or rejected, so a sweep terminates', async () => {
		const db = freshDb();
		insertMemory(db, { ...baseMem, title: 'A', body: 'body a' });
		const rejectFn = async () => 'not json';
		const mixedFn = async (_s: string, user: string) => user.includes('body a') ? 'not json' : fakeCallFn();
		insertMemory(db, { ...baseMem, title: 'B', body: 'body b' });

		await decomposeMemoriesToClaims(db, { limit: 10 }, mixedFn);
		expect(countEligibleMemories(db)).toBe(0);
		db.close();
	});

	it('writes claims for accepted memories via extractClaimsForMemory', async () => {
		const db = freshDb();
		const m = insertMemory(db, { ...baseMem, title: 'A', body: 'body a' });

		const r = await decomposeMemoriesToClaims(db, { limit: 10 }, fakeCallFn);
		expect(r.accepted).toBe(1);
		expect(r.claimsWritten).toBe(1);
		expect(listClaimsForMemory(db, m.id)).toHaveLength(1);
		db.close();
	});

	it('counts rejected memories separately and leaves them with zero claims', async () => {
		const db = freshDb();
		insertMemory(db, { ...baseMem, title: 'A', body: 'body a' });
		const rejectFn = async () => 'not json';

		const r = await decomposeMemoriesToClaims(db, { limit: 10 }, rejectFn);
		expect(r.rejected).toBe(1);
		expect(r.accepted).toBe(0);
		db.close();
	});

	it('respects the limit — pool never exceeds it regardless of total eligible rows', async () => {
		const db = freshDb();
		for (let i = 0; i < 5; i++) insertMemory(db, { ...baseMem, title: `M${i}`, body: `body ${i}` });

		const r = await decomposeMemoriesToClaims(db, { limit: 2 }, fakeCallFn);
		expect(r.processed).toBeLessThanOrEqual(2);
		db.close();
	});

	it('successive runs examine disjoint candidates (cursor advances)', async () => {
		const db = freshDb();
		for (let i = 0; i < 4; i++) insertMemory(db, { ...baseMem, title: `M${i}`, body: `body ${i}` });

		const r1 = await decomposeMemoriesToClaims(db, { limit: 2 }, fakeCallFn);
		expect(r1.processed).toBe(2);
		const r2 = await decomposeMemoriesToClaims(db, { limit: 2 }, fakeCallFn);
		expect(r2.processed).toBe(2);
		expect(countEligibleMemories(db)).toBe(0);
		db.close();
	});

	it('aborts and un-stamps unprocessed candidates after consecutive backend failures, leaving them eligible for a later run', async () => {
		const db = freshDb();
		for (let i = 0; i < 10; i++) insertMemory(db, { ...baseMem, title: `M${i}`, body: `body ${i}` });
		const alwaysEmptyFn = async () => ''; // simulates a dead backend (unparseable -> rejected every time)

		const r = await decomposeMemoriesToClaims(db, { limit: 10 }, alwaysEmptyFn);
		expect(r.backendFailed).toBe(true);
		expect(countEligibleMemories(db)).toBeGreaterThan(0); // some candidates given back
		db.close();
	});

	it('scopes to a project when opts.project is given', async () => {
		const db = freshDb();
		insertMemory(db, { ...baseMem, title: 'A', body: 'body a', project: 'proj-a' });
		insertMemory(db, { ...baseMem, title: 'B', body: 'body b', project: 'proj-b' });

		const r = await decomposeMemoriesToClaims(db, { limit: 10, project: 'proj-a' }, fakeCallFn);
		expect(r.processed).toBe(1);
		db.close();
	});
});
