import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { insertMemory } from './memories.js';
import { insertClaim, embedClaim } from './claims.js';
import { classifyDedupBand, fuzzyStringSimilarity, findDedupCandidates, combinedSimilarity, loadStoredClaimVector, claimCosineSimilarity } from './claim-dedup.js';

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

describe('classifyDedupBand', () => {
	// Defaults per DDR-20260808153555-7a / source-33: start conservative (0.98/0.92),
	// relax only after validating quality on the real corpus.
	it('classifies at/above the auto-merge threshold as auto_merge', () => {
		expect(classifyDedupBand(0.98)).toBe('auto_merge');
		expect(classifyDedupBand(0.99)).toBe('auto_merge');
		expect(classifyDedupBand(1.0)).toBe('auto_merge');
	});

	it('classifies at/above flag but below auto-merge as flag (pending review)', () => {
		expect(classifyDedupBand(0.92)).toBe('flag');
		expect(classifyDedupBand(0.95)).toBe('flag');
		expect(classifyDedupBand(0.979)).toBe('flag');
	});

	it('classifies below flag as new (not a candidate at all)', () => {
		expect(classifyDedupBand(0.91)).toBe('new');
		expect(classifyDedupBand(0)).toBe('new');
	});

	it('accepts caller-supplied thresholds instead of the defaults', () => {
		expect(classifyDedupBand(0.80, { autoMerge: 0.85, flag: 0.75 })).toBe('flag');
		expect(classifyDedupBand(0.90, { autoMerge: 0.85, flag: 0.75 })).toBe('auto_merge');
	});
});

describe('fuzzyStringSimilarity', () => {
	it('returns 1.0 for identical strings', () => {
		expect(fuzzyStringSimilarity('MERGE_COVERAGE_FLOOR is 0.72', 'MERGE_COVERAGE_FLOOR is 0.72')).toBe(1.0);
	});

	it('returns 1.0 for identical strings differing only in case/whitespace', () => {
		expect(fuzzyStringSimilarity('Max Cluster is 3', '  max   cluster is 3  ')).toBe(1.0);
	});

	it('returns a low score for unrelated strings', () => {
		expect(fuzzyStringSimilarity('MERGE_COVERAGE_FLOOR is 0.72', 'completely unrelated sentence about zebras')).toBeLessThan(0.3);
	});

	it('returns a high but non-1.0 score for near-duplicate paraphrases', () => {
		const score = fuzzyStringSimilarity('MAX_CLUSTER is capped at 3', 'MAX_CLUSTER is capped to 3');
		expect(score).toBeGreaterThan(0.7);
		expect(score).toBeLessThan(1.0);
	});

	it('handles empty strings without throwing', () => {
		expect(fuzzyStringSimilarity('', '')).toBe(1.0);
		expect(fuzzyStringSimilarity('something', '')).toBe(0);
	});
});

describe('combinedSimilarity', () => {
	// Neo4j Agent Memory's blend (source-33): embedding*0.7 + fuzzy*0.3.
	it('blends embedding and fuzzy scores 0.7/0.3', () => {
		expect(combinedSimilarity(1.0, 0.0)).toBeCloseTo(0.7, 5);
		expect(combinedSimilarity(0.0, 1.0)).toBeCloseTo(0.3, 5);
		expect(combinedSimilarity(0.8, 0.5)).toBeCloseTo(0.8 * 0.7 + 0.5 * 0.3, 5);
	});

	it('falls back to fuzzy-only when no embedding score is available (embeddings absent)', () => {
		expect(combinedSimilarity(null, 0.6)).toBe(0.6);
	});
});

describe('claimCosineSimilarity / loadStoredClaimVector', () => {
	it('returns the cosine similarity between two embedded claims', async () => {
		const db = freshDb();
		const m1 = insertMemory(db, { ...baseMem, title: 'M1', body: 'body one' });
		const { id: a } = insertClaim(db, { memory_id: m1.id, source_memory_id: m1.id, fact: 'claim A', claim_type: 'decision', confidence: 0.7 });
		const { id: b } = insertClaim(db, { memory_id: m1.id, source_memory_id: m1.id, fact: 'claim B', claim_type: 'decision', confidence: 0.7 });

		const vecA = new Float32Array(1024); vecA[0] = 1;
		const vecB = new Float32Array(1024); vecB[0] = 1;
		await embedClaim(db, a, async () => vecA);
		await embedClaim(db, b, async () => vecB);

		expect(claimCosineSimilarity(db, a, b)).toBeCloseTo(1.0, 5);
		db.close();
	});

	it('returns null when either claim has no stored vector', () => {
		const db = freshDb();
		const m1 = insertMemory(db, { ...baseMem, title: 'M1', body: 'body one' });
		const { id: a } = insertClaim(db, { memory_id: m1.id, source_memory_id: m1.id, fact: 'claim A', claim_type: 'decision', confidence: 0.7 });
		const { id: b } = insertClaim(db, { memory_id: m1.id, source_memory_id: m1.id, fact: 'claim B', claim_type: 'decision', confidence: 0.7 });

		expect(claimCosineSimilarity(db, a, b)).toBeNull();
		db.close();
	});

	it('loadStoredClaimVector returns null for a claim with no stored embedding', () => {
		const db = freshDb();
		const m1 = insertMemory(db, { ...baseMem, title: 'M1', body: 'body one' });
		const { id } = insertClaim(db, { memory_id: m1.id, source_memory_id: m1.id, fact: 'claim', claim_type: 'decision', confidence: 0.7 });
		const rowid = (db.prepare(`SELECT rowid FROM claims WHERE id = ?`).get(id) as { rowid: number }).rowid;
		expect(loadStoredClaimVector(db, rowid)).toBeNull();
		db.close();
	});
});

describe('findDedupCandidates', () => {
	const baseMem = {
		memory_type: 'decision' as const, scope: 'project' as const, project: 'p', confidence: 0.8,
		decay_class: 'stable' as const, review_status: 'approved' as const,
		source_session_id: null, discovered_from: null, tags: [], promotion_target: 'none' as const,
	};

	it('only returns claims of the same claim_type', () => {
		const db = freshDb();
		const m1 = insertMemory(db, { ...baseMem, title: 'M1', body: 'body one' });
		const m2 = insertMemory(db, { ...baseMem, title: 'M2', body: 'body two' });
		insertClaim(db, { memory_id: m1.id, source_memory_id: m1.id, fact: 'A decision fact', claim_type: 'decision', confidence: 0.7 });
		const { id: insightId } = insertClaim(db, { memory_id: m2.id, source_memory_id: m2.id, fact: 'An insight fact', claim_type: 'insight', confidence: 0.7 });
		const insightClaim = { memory_id: m2.id, claim_type: 'insight' as const, fact: 'An insight fact', id: insightId };

		const candidates = findDedupCandidates(db, insightClaim);
		expect(candidates.every((c) => c.claim_type === 'insight')).toBe(true);
		expect(candidates.some((c) => c.claim_type === 'decision')).toBe(false);
		db.close();
	});

	it('excludes the claim itself', () => {
		const db = freshDb();
		const m1 = insertMemory(db, { ...baseMem, title: 'M1', body: 'body one' });
		const { id } = insertClaim(db, { memory_id: m1.id, source_memory_id: m1.id, fact: 'A decision fact', claim_type: 'decision', confidence: 0.7 });

		const candidates = findDedupCandidates(db, { memory_id: m1.id, claim_type: 'decision', fact: 'A decision fact', id });
		expect(candidates.map((c) => c.id)).not.toContain(id);
		db.close();
	});

	it('excludes claims already marked invalid', () => {
		const db = freshDb();
		const m1 = insertMemory(db, { ...baseMem, title: 'M1', body: 'body one' });
		const m2 = insertMemory(db, { ...baseMem, title: 'M2', body: 'body two' });
		const { id: liveId } = insertClaim(db, { memory_id: m2.id, source_memory_id: m2.id, fact: 'still valid', claim_type: 'decision', confidence: 0.7 });
		const { id: invalidId } = insertClaim(db, { memory_id: m2.id, source_memory_id: m2.id, fact: 'no longer valid', claim_type: 'decision', confidence: 0.7 });
		db.prepare(`UPDATE claims SET valid_until = datetime('now') WHERE id = ?`).run(invalidId);
		const { id: queryId } = insertClaim(db, { memory_id: m1.id, source_memory_id: m1.id, fact: 'query claim', claim_type: 'decision', confidence: 0.7 });

		const candidates = findDedupCandidates(db, { memory_id: m1.id, claim_type: 'decision', fact: 'query claim', id: queryId });
		expect(candidates.map((c) => c.id)).toContain(liveId);
		expect(candidates.map((c) => c.id)).not.toContain(invalidId);
		db.close();
	});

	it('scopes to the same project as the query claim\'s parent memory', () => {
		const db = freshDb();
		const mA = insertMemory(db, { ...baseMem, title: 'MA', body: 'body a', project: 'proj-a' });
		const mB = insertMemory(db, { ...baseMem, title: 'MB', body: 'body b', project: 'proj-b' });
		const { id: otherProjectId } = insertClaim(db, { memory_id: mB.id, source_memory_id: mB.id, fact: 'in proj-b', claim_type: 'decision', confidence: 0.7 });
		const { id: queryId } = insertClaim(db, { memory_id: mA.id, source_memory_id: mA.id, fact: 'in proj-a', claim_type: 'decision', confidence: 0.7 });

		const candidates = findDedupCandidates(db, { memory_id: mA.id, claim_type: 'decision', fact: 'in proj-a', id: queryId });
		expect(candidates.map((c) => c.id)).not.toContain(otherProjectId);
		db.close();
	});
});
