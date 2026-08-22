import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDatabase, initializeSchema } from './database.js'
import { insertMemory, embedMemory } from './memories.js'
import { sanitizeFts5Query, searchMemories, hybridSearchMemories, getSessionById, logSessionSearch, searchSession, getStats } from './search.js'

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

	it('AND-joins short queries at or under the natural-language threshold', () => {
		expect(sanitizeFts5Query('foo bar baz qux quux')).toBe('"foo" "bar" "baz" "qux" "quux"')
	})

	it('OR-joins and drops stopwords for long natural-language queries', () => {
		const result = sanitizeFts5Query('what conventions should I follow for writing efficient mobile shaders')
		expect(result).toBe('"conventions" OR "follow" OR "writing" OR "efficient" OR "mobile" OR "shaders"')
	})

	it('keeps every token when a long query is all stopwords', () => {
		const result = sanitizeFts5Query('what is the this that these those how when where why')
		expect(result).toBe('"what" OR "is" OR "the" OR "this" OR "that" OR "these" OR "those" OR "how" OR "when" OR "where" OR "why"')
	})

	it('does not switch to OR when the query already has an explicit operator, even if long', () => {
		const result = sanitizeFts5Query('foo AND bar AND baz AND qux AND quux AND corge')
		expect(result).toBe('"foo" AND "bar" AND "baz" AND "qux" AND "quux" AND "corge"')
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

	// Regression for the FTS-only-returns-zero-hits bug: a long natural-language
	// query used to be sanitized into ~15 mandatory ANDed tokens (including
	// stopwords), which no realistic memory body satisfies verbatim.
	it('returns hits for a long natural-language query against realistic memory content', () => {
		const db = freshDb()
		insertMemory(db, {
			...memBase,
			title: 'Mobile Shader Conventions',
			body: 'For efficient mobile shaders, avoid per-pixel branching and keep the instruction count low on tile-based GPUs.',
			memory_type: 'convention',
		})
		insertMemory(db, {
			...memBase,
			title: 'Unrelated Memory',
			body: 'The database migration script backs up records before applying schema changes.',
			memory_type: 'convention',
		})

		const results = searchMemories(db, 'In this project, what conventions should I follow for writing efficient mobile shaders?')
		expect(results.length).toBeGreaterThanOrEqual(1)
		expect(results.map(r => r.memory.title)).toContain('Mobile Shader Conventions')
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

// ── getSessionById / logSessionSearch ────────────────────────────────────────

function insertTestSession(db: Database.Database, o: { id: string; vccShrunkPath?: string | null }) {
	db.prepare(`
		INSERT INTO sessions (session_id, project, jsonl_path, vcc_shrunk_path)
		VALUES (?, ?, ?, ?)
	`).run(o.id, 'test-proj', `/tmp/${o.id}.jsonl`, o.vccShrunkPath ?? null)
}

describe('getSessionById', () => {
	it('returns the session row when session_id exists', () => {
		const db = freshDb()
		insertTestSession(db, { id: 'sess-1', vccShrunkPath: '/tmp/sess-1.compacted.jsonl' })

		const row = getSessionById(db, 'sess-1')

		expect(row).toBeDefined()
		expect(row!.session_id).toBe('sess-1')
		expect(row!.project).toBe('test-proj')
		expect(row!.jsonl_path).toBe('/tmp/sess-1.jsonl')
		expect(row!.vcc_shrunk_path).toBe('/tmp/sess-1.compacted.jsonl')
		db.close()
	})

	it('returns undefined (not a throw) when session_id is unknown', () => {
		const db = freshDb()
		expect(() => getSessionById(db, 'does-not-exist')).not.toThrow()
		expect(getSessionById(db, 'does-not-exist')).toBeUndefined()
		db.close()
	})
})

describe('logSessionSearch', () => {
	it('inserts a row into session_search_log with the given fields', () => {
		const db = freshDb()
		insertTestSession(db, { id: 'sess-1' })

		logSessionSearch(db, { sessionId: 'sess-1', query: 'foo bar', source: 'compacted', matchCount: 3 })

		const row = db.prepare(`SELECT * FROM session_search_log WHERE session_id = ?`).get('sess-1') as {
			session_id: string
			query: string
			source: string
			match_count: number
		}
		expect(row).toBeDefined()
		expect(row.session_id).toBe('sess-1')
		expect(row.query).toBe('foo bar')
		expect(row.source).toBe('compacted')
		expect(row.match_count).toBe(3)
		db.close()
	})

	it('throws (does not swallow) on a CHECK-constraint violation for an invalid source', () => {
		const db = freshDb()
		insertTestSession(db, { id: 'sess-1' })

		expect(() =>
			logSessionSearch(db, { sessionId: 'sess-1', query: 'q', source: 'bogus' as 'compacted', matchCount: 0 })
		).toThrow()
		db.close()
	})
})

// ── searchSession ─────────────────────────────────────────────────────────────

describe('searchSession', () => {
	let tmpDir: string

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'nexus-search-session-'))
	})

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true })
	})

	function insertSession(db: Database.Database, o: { id: string; jsonlPath?: string | null; vccShrunkPath?: string | null }) {
		db.prepare(`
			INSERT INTO sessions (session_id, project, jsonl_path, vcc_shrunk_path)
			VALUES (?, ?, ?, ?)
		`).run(o.id, 'test-proj', o.jsonlPath ?? null, o.vccShrunkPath ?? null)
	}

	function countLogRows(db: Database.Database, sessionId: string): number {
		return (db.prepare(`SELECT COUNT(*) as c FROM session_search_log WHERE session_id = ?`).get(sessionId) as { c: number }).c
	}

	it('returns session-not-found and still logs when session_id is unknown', () => {
		const db = freshDb()

		const result = searchSession(db, 'ghost', 'anything')

		expect(result.status).toBe('session-not-found')
		expect(result.source).toBe('none')
		expect(result.detail).toBeTruthy()
		expect(countLogRows(db, 'ghost')).toBe(1)
		db.close()
	})

	it('finds a match in the compacted file and reports source compacted', () => {
		const db = freshDb()
		const compactedPath = join(tmpDir, 'sess-1.compacted.txt')
		writeFileSync(compactedPath, 'line one\nthe needle is here\nline three', 'utf8')
		insertSession(db, { id: 'sess-1', jsonlPath: join(tmpDir, 'sess-1.jsonl'), vccShrunkPath: compactedPath })

		const result = searchSession(db, 'sess-1', 'needle')

		expect(result.status).toBe('ok')
		expect(result.source).toBe('compacted')
		expect(result.sourcesChecked).toEqual(['compacted summary'])
		expect(result.totalMatches).toBe(1)
		expect(result.matches[0].snippet).toContain('needle')

		const row = db.prepare(`SELECT source, match_count FROM session_search_log WHERE session_id = ?`).get('sess-1') as { source: string; match_count: number }
		expect(row.source).toBe('compacted')
		expect(row.match_count).toBe(1)
		db.close()
	})

	it('falls back to the full transcript when vcc_shrunk_path is null', () => {
		const db = freshDb()
		const jsonlPath = join(tmpDir, 'sess-2.jsonl')
		writeFileSync(jsonlPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'find the needle please' } }) + '\n', 'utf8')
		insertSession(db, { id: 'sess-2', jsonlPath, vccShrunkPath: null })

		const result = searchSession(db, 'sess-2', 'needle')

		expect(result.status).toBe('ok')
		expect(result.source).toBe('full')
		expect(result.sourcesChecked).toEqual(['full transcript'])
		expect(result.totalMatches).toBeGreaterThanOrEqual(1)
		db.close()
	})

	it('falls back to the full transcript when the compacted file is missing on disk', () => {
		const db = freshDb()
		const jsonlPath = join(tmpDir, 'sess-3.jsonl')
		writeFileSync(jsonlPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'find the needle please' } }) + '\n', 'utf8')
		insertSession(db, { id: 'sess-3', jsonlPath, vccShrunkPath: join(tmpDir, 'does-not-exist.txt') })

		const result = searchSession(db, 'sess-3', 'needle')

		expect(result.status).toBe('ok')
		expect(result.source).toBe('full')
		expect(result.sourcesChecked).toEqual(['full transcript'])
		db.close()
	})

	it('falls back to the full transcript when the compacted file has zero matches', () => {
		const db = freshDb()
		const compactedPath = join(tmpDir, 'sess-4.compacted.txt')
		writeFileSync(compactedPath, 'nothing relevant here', 'utf8')
		const jsonlPath = join(tmpDir, 'sess-4.jsonl')
		writeFileSync(jsonlPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'find the needle please' } }) + '\n', 'utf8')
		insertSession(db, { id: 'sess-4', jsonlPath, vccShrunkPath: compactedPath })

		const result = searchSession(db, 'sess-4', 'needle')

		expect(result.status).toBe('ok')
		expect(result.source).toBe('full')
		expect(result.sourcesChecked).toEqual(['compacted summary', 'full transcript'])
		db.close()
	})

	it('returns no-matches (both sources checked, zero hits) and logs source none', () => {
		const db = freshDb()
		const compactedPath = join(tmpDir, 'sess-5.compacted.txt')
		writeFileSync(compactedPath, 'nothing relevant here', 'utf8')
		const jsonlPath = join(tmpDir, 'sess-5.jsonl')
		writeFileSync(jsonlPath, JSON.stringify({ type: 'user', message: { role: 'user', content: 'still nothing relevant' } }) + '\n', 'utf8')
		insertSession(db, { id: 'sess-5', jsonlPath, vccShrunkPath: compactedPath })

		const result = searchSession(db, 'sess-5', 'needle')

		expect(result.status).toBe('no-matches')
		expect(result.source).toBe('none')
		expect(result.sourcesChecked).toEqual(['compacted summary', 'full transcript'])
		expect(result.matches).toEqual([])

		const row = db.prepare(`SELECT source, match_count FROM session_search_log WHERE session_id = ?`).get('sess-5') as { source: string; match_count: number }
		expect(row.source).toBe('none')
		expect(row.match_count).toBe(0)
		db.close()
	})

	it('returns no-content when jsonl_path is empty and there is no compacted file', () => {
		const db = freshDb()
		insertSession(db, { id: 'sess-6', jsonlPath: '', vccShrunkPath: null })

		const result = searchSession(db, 'sess-6', 'needle')

		expect(result.status).toBe('no-content')
		expect(result.source).toBe('none')
		expect(result.detail).toBeTruthy()
		expect(countLogRows(db, 'sess-6')).toBe(1)
		db.close()
	})

	it('returns no-content when jsonl_path points to a missing file (readTranscriptWindow returns empty text)', () => {
		const db = freshDb()
		insertSession(db, { id: 'sess-7', jsonlPath: join(tmpDir, 'missing.jsonl'), vccShrunkPath: null })

		const result = searchSession(db, 'sess-7', 'needle')

		expect(result.status).toBe('no-content')
		expect(result.source).toBe('none')
		db.close()
	})

	it('never throws to the caller even when logSessionSearch write fails (fail-open)', () => {
		const db = freshDb()
		insertSession(db, { id: 'sess-8', jsonlPath: '', vccShrunkPath: null })

		const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		db.prepare(`DROP TABLE session_search_log`).run()

		let result
		expect(() => { result = searchSession(db, 'sess-8', 'needle') }).not.toThrow()
		expect(result!.status).toBe('no-content')
		expect(stderrSpy).toHaveBeenCalled()

		stderrSpy.mockRestore()
		db.close()
	})
})

// ── getStats — session-search counts ─────────────────────────────────────────

describe('getStats — session-search counts', () => {
	it('zero-fills all 3 source keys to 0 when session_search_log is empty', () => {
		const db = freshDb()

		const stats = getStats(db)

		expect(stats.totalSessionSearches).toBe(0)
		expect(stats.sessionSearchesBySource).toEqual({ compacted: 0, full: 0, none: 0 })
		db.close()
	})

	it('reports correct total and per-source counts across all 3 sources', () => {
		const db = freshDb()
		insertTestSession(db, { id: 'sess-1' })
		logSessionSearch(db, { sessionId: 'sess-1', query: 'a', source: 'compacted', matchCount: 1 })
		logSessionSearch(db, { sessionId: 'sess-1', query: 'b', source: 'compacted', matchCount: 2 })
		logSessionSearch(db, { sessionId: 'sess-1', query: 'c', source: 'full', matchCount: 1 })
		logSessionSearch(db, { sessionId: 'sess-1', query: 'd', source: 'none', matchCount: 0 })
		logSessionSearch(db, { sessionId: 'sess-1', query: 'e', source: 'none', matchCount: 0 })
		logSessionSearch(db, { sessionId: 'sess-1', query: 'f', source: 'none', matchCount: 0 })

		const stats = getStats(db)

		expect(stats.totalSessionSearches).toBe(6)
		expect(stats.sessionSearchesBySource).toEqual({ compacted: 2, full: 1, none: 3 })
		db.close()
	})

	it('regression: every pre-existing Stats key/type is unchanged', () => {
		const db = freshDb()

		const stats = getStats(db)

		expect(typeof stats.totalAtoms).toBe('number')
		expect(typeof stats.embeddedAtoms).toBe('number')
		expect(typeof stats.atomsByType).toBe('object')
		expect(typeof stats.atomsByScope).toBe('object')
		expect(typeof stats.atomsByProject).toBe('object')
		expect(typeof stats.totalMemories).toBe('number')
		expect(typeof stats.embeddedMemories).toBe('number')
		expect(typeof stats.memoriesByReview).toBe('object')
		expect(typeof stats.totalLinks).toBe('number')
		expect(typeof stats.totalSessions).toBe('number')
		expect(typeof stats.totalDiagnostics).toBe('number')
		expect(typeof stats.diagnosticsByType).toBe('object')

		expect(Object.keys(stats).sort()).toEqual([
			'atomsByProject',
			'atomsByScope',
			'atomsByType',
			'diagnosticsByType',
			'embeddedAtoms',
			'embeddedMemories',
			'memoriesByReview',
			'sessionSearchesBySource',
			'totalAtoms',
			'totalDiagnostics',
			'totalLinks',
			'totalMemories',
			'totalSessionSearches',
			'totalSessions',
		])
		db.close()
	})
})
