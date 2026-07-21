import { vi, describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { openDatabase, initializeSchema } from './database.js'
import { insertMemory, embedMemory } from './memories.js'
import { sanitizeFts5Query, searchMemories, hybridSearchMemories } from './search.js'

// Mock generateEmbedding so tests don't require Ollama running.
// Default: returns null (vec unavailable), overridden per-test for hybrid path.
vi.mock('./embeddings.js', () => ({
	generateEmbedding: vi.fn().mockResolvedValue(null),
	ensureEmbeddingModelReady: vi.fn().mockResolvedValue(undefined),
}))

// Spy wrapper for rrfFuse — delegates to real implementation so ordering tests
// still produce correct results. Lets us assert rrfFuse is called by the refactored
// hybridSearchMemories path (RED before refactor, GREEN after).
vi.mock('./rrf.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('./rrf.js')>()
	return {
		...original,
		rrfFuse: vi.fn(original.rrfFuse),
	}
})

import { generateEmbedding } from './embeddings.js'
import { rrfFuse } from './rrf.js'

// ── helpers ──────────────────────────────────────────────────────────────────

function freshDb() {
	const db = openDatabase(':memory:')
	initializeSchema(db)
	return db
}

const memBase = {
	scope: 'project' as const,
	project: 'test-proj',
	confidence: 0.9,
	decay_class: 'stable' as const,
	source_session_id: null,
	discovered_from: null,
	tags: [],
	promotion_target: 'none' as const,
	review_status: 'approved' as const,
}

// ── sanitizeFts5Query ─────────────────────────────────────────────────────────

describe('sanitizeFts5Query', () => {
	it('returns "" for empty string', () => {
		expect(sanitizeFts5Query('')).toBe('""')
	})

	it('returns "" for whitespace-only input', () => {
		expect(sanitizeFts5Query('   ')).toBe('""')
	})

	it('wraps a single token in double quotes', () => {
		expect(sanitizeFts5Query('hello')).toBe('"hello"')
	})

	it('wraps each space-separated token individually', () => {
		expect(sanitizeFts5Query('foo bar')).toBe('"foo" "bar"')
	})

	it('passes FTS5 boolean operators through unquoted', () => {
		expect(sanitizeFts5Query('foo AND bar')).toBe('"foo" AND "bar"')
		expect(sanitizeFts5Query('foo OR bar NOT baz')).toBe('"foo" OR "bar" NOT "baz"')
	})

	it('passes a quoted phrase through unchanged', () => {
		expect(sanitizeFts5Query('"exact phrase"')).toBe('"exact phrase"')
	})

	it('converts a prefix token (word*) to "word" * form', () => {
		expect(sanitizeFts5Query('hell*')).toBe('"hell" *')
	})

	it('strips embedded double-quotes from ordinary tokens', () => {
		expect(sanitizeFts5Query('say"hello')).toBe('"sayhello"')
	})
})

// ── searchMemories ────────────────────────────────────────────────────────────

describe('searchMemories', () => {
	it('returns [] when memories_fts table is absent', () => {
		const db = new Database(':memory:')
		expect(searchMemories(db, 'anything')).toEqual([])
		db.close()
	})

	it('returns FTS matches for approved memories', () => {
		const db = freshDb()
		insertMemory(db, { ...memBase, title: 'Alpha Memory', body: 'alpha alpha alpha', memory_type: 'convention' })
		insertMemory(db, { ...memBase, title: 'Unrelated Memory', body: 'delta epsilon zeta', memory_type: 'convention' })

		const results = searchMemories(db, 'alpha')
		expect(results).toHaveLength(1)
		expect(results[0].memory.title).toBe('Alpha Memory')
		db.close()
	})

	it('excludes pending and rejected memories', () => {
		const db = freshDb()
		insertMemory(db, { ...memBase, title: 'Pending', body: 'alpha content', memory_type: 'convention', review_status: 'pending' })
		insertMemory(db, { ...memBase, title: 'Approved', body: 'alpha approved', memory_type: 'convention', review_status: 'approved' })

		const results = searchMemories(db, 'alpha')
		expect(results).toHaveLength(1)
		expect(results[0].memory.title).toBe('Approved')
		db.close()
	})

	it('filters by project when option supplied', () => {
		const db = freshDb()
		insertMemory(db, { ...memBase, project: 'proj-a', title: 'A', body: 'alpha content here', memory_type: 'convention' })
		insertMemory(db, { ...memBase, project: 'proj-b', title: 'B', body: 'alpha content here', memory_type: 'convention' })

		const results = searchMemories(db, 'alpha', { project: 'proj-a' })
		expect(results).toHaveLength(1)
		expect(results[0].memory.title).toBe('A')
		db.close()
	})
})

// ── hybridSearchMemories ──────────────────────────────────────────────────────

describe('hybridSearchMemories', () => {
	beforeEach(() => {
		vi.mocked(generateEmbedding).mockResolvedValue(null)
		vi.mocked(rrfFuse).mockClear()
	})

	it('falls back to FTS results when generateEmbedding returns null', async () => {
		const db = freshDb()
		insertMemory(db, { ...memBase, title: 'Alpha Hit', body: 'alpha beta gamma delta', memory_type: 'convention' })

		const results = await hybridSearchMemories(db, 'alpha')
		expect(results).toHaveLength(1)
		expect(results[0].memory.title).toBe('Alpha Hit')
		db.close()
	})

	it('returns FTS results unchanged when memories_vec table is absent', async () => {
		// DB without vec table: initializeSchema creates it via sqlite-vec if available,
		// but the fallback branch still exercises `if (vecRank.size === 0) return ftsResults`.
		const queryVec = new Float32Array(1024)
		queryVec[0] = 1.0
		vi.mocked(generateEmbedding).mockResolvedValue(queryVec)

		// Bare DB: no schema at all → searchMemories returns [] → ftsResults is empty
		// so vecMemIds.length === 0 fallback fires.
		const db = new Database(':memory:')
		const results = await hybridSearchMemories(db, 'alpha')
		expect(results).toEqual([])
		db.close()
	})

	// ── characterization test — fused ordering + RED guard ───────────────────
	//
	// Layout:
	//   Mem A: FTS rank 1 (4× "alpha" in 4-word doc), vec rank 3 (dim-2 unit vector)
	//   Mem B: FTS rank 2 (1× "alpha" in 4-word doc), vec rank 1 (dim-0 unit vector, aligned with query)
	//   Mem C: not in FTS ("delta epsilon"), vec rank 2 (dim-1 unit vector, ~45° from query)
	//
	// Query vec = [1, 0, 0, ...] (dim-0 unit vector)
	//   L2 distance: B=0, C≈√2*0.7071≈1, A=√2≈1.41 → vec ranks B=1, C=2, A=3
	//
	// RRF (k=60, 1-indexed):
	//   A: 1/61 + 1/63 ≈ 0.03226
	//   B: 1/62 + 1/61 ≈ 0.03252
	//   C:  0   + 1/62 ≈ 0.01613
	//   Expected order: B > A > C
	//
	// RED before refactor: rrfFuse is never called in the inlined loop.
	// GREEN after refactor: hybridSearchMemories delegates to rrfFuse.
	it('delegates fusion to rrfFuse and returns results in fused order (B > A > C)', async () => {
		const queryVec = new Float32Array(1024)
		queryVec[0] = 1.0
		vi.mocked(generateEmbedding).mockResolvedValue(queryVec)

		const db = freshDb()

		// Mem A — strong FTS hit, weak vec alignment
		const { id: idA } = insertMemory(db, {
			...memBase,
			title: 'Mem A',
			body: 'alpha alpha alpha alpha',
			memory_type: 'convention',
		})
		const vecA = new Float32Array(1024)
		vecA[2] = 1.0 // dim-2 unit vector — L2 distance from query [1,0,0,...] is √2 ≈ 1.41
		await embedMemory(db, idA, async () => vecA)

		// Mem B — moderate FTS hit, strong vec alignment
		const { id: idB } = insertMemory(db, {
			...memBase,
			title: 'Mem B',
			body: 'alpha beta gamma delta',
			memory_type: 'convention',
		})
		const vecB = new Float32Array(1024)
		vecB[0] = 1.0 // dim-0 unit vector — identical direction to query, distance = 0
		await embedMemory(db, idB, async () => vecB)

		// Mem C — no FTS match, medium vec alignment
		const { id: idC } = insertMemory(db, {
			...memBase,
			title: 'Mem C',
			body: 'delta epsilon zeta omega',
			memory_type: 'convention',
		})
		const vecC = new Float32Array(1024)
		vecC[0] = 0.7071
		vecC[1] = 0.7071 // ~45° from query, L2 dist ≈ √(0.086+0.5) ≈ 0.765 (between B and A)
		await embedMemory(db, idC, async () => vecC)

		const results = await hybridSearchMemories(db, 'alpha')

		// RED guard: rrfFuse must have been called by the refactored path
		expect(rrfFuse).toHaveBeenCalled()

		// Characterization: fused order B > A > C
		const titles = results.map((r) => r.memory.title)
		expect(titles[0]).toBe('Mem B')
		expect(titles[1]).toBe('Mem A')
		expect(titles[2]).toBe('Mem C')

		// rank field follows negative-score convention (lower = better BM25/RRF)
		expect(results[0].rank).toBeLessThan(0)

		db.close()
	})
})
