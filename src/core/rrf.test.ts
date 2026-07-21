import { describe, it, expect } from 'vitest'
import { rrfFuse, RRF_K } from './rrf.js'

describe('rrfFuse', () => {
	it('exports RRF_K = 60', () => {
		expect(RRF_K).toBe(60)
	})

	it('returns [] for empty input', () => {
		expect(rrfFuse([])).toEqual([])
	})

	it('returns [] for input containing only empty lists', () => {
		expect(rrfFuse([[], []])).toEqual([])
	})

	it('single-list input preserves original order', () => {
		const result = rrfFuse([[10, 20, 30]])
		expect(result.map(r => r.id)).toEqual([10, 20, 30])
	})

	it('single-list: exact scores use 1/(k+rank) with 1-indexed rank', () => {
		// id=10 rank=1 → 1/61, id=20 rank=2 → 1/62, id=30 rank=3 → 1/63
		const result = rrfFuse([[10, 20, 30]])
		expect(result[0].score).toBeCloseTo(1 / 61, 10)
		expect(result[1].score).toBeCloseTo(1 / 62, 10)
		expect(result[2].score).toBeCloseTo(1 / 63, 10)
	})

	it('two lists: known fusion produces expected order and scores', () => {
		// list A: [1, 2, 3]  → id1 rank=1, id2 rank=2, id3 rank=3
		// list B: [3, 1, 2]  → id3 rank=1, id1 rank=2, id2 rank=3
		// k=60
		// id1: 1/61 + 1/62 = 0.016393... + 0.016129... = 0.032522...
		// id2: 1/62 + 1/63 = 0.016129... + 0.015873... = 0.032002...
		// id3: 1/63 + 1/61 = 0.015873... + 0.016393... = 0.032266...
		// order: id1 > id3 > id2
		const result = rrfFuse([[1, 2, 3], [3, 1, 2]])
		expect(result[0].id).toBe(1)
		expect(result[1].id).toBe(3)
		expect(result[2].id).toBe(2)

		expect(result[0].score).toBeCloseTo(1 / 61 + 1 / 62, 10)
		expect(result[1].score).toBeCloseTo(1 / 63 + 1 / 61, 10)
		expect(result[2].score).toBeCloseTo(1 / 62 + 1 / 63, 10)
	})

	it('id missing from one list contributes 0 from that list', () => {
		// list A: [1, 2]   → id1 rank=1, id2 rank=2
		// list B: [2, 3]   → id2 rank=1, id3 rank=2
		// id1: 1/61 (only in A)
		// id2: 1/62 + 1/61
		// id3: 1/62 (only in B)
		const result = rrfFuse([[1, 2], [2, 3]])
		const byId = Object.fromEntries(result.map(r => [r.id, r.score]))
		expect(byId[1]).toBeCloseTo(1 / 61, 10)
		expect(byId[2]).toBeCloseTo(1 / 62 + 1 / 61, 10)
		expect(byId[3]).toBeCloseTo(1 / 62, 10)
		// id2 should rank first
		expect(result[0].id).toBe(2)
	})

	it('duplicate id in one list: first (best) position wins, later occurrences ignored', () => {
		// list A: [5, 5, 10]  → id5 first rank=1, duplicate at rank=2 ignored; id10 rank=3
		const result = rrfFuse([[5, 5, 10]])
		// id5 should appear once with score 1/61 (rank 1), not 1/61 + 1/62
		expect(result.filter(r => r.id === 5)).toHaveLength(1)
		expect(result.find(r => r.id === 5)!.score).toBeCloseTo(1 / 61, 10)
		expect(result.find(r => r.id === 10)!.score).toBeCloseTo(1 / 63, 10)
	})

	it('three lists: aggregates contributions from all lists', () => {
		// list A: [7]  → id7 rank=1 → 1/61
		// list B: [7]  → id7 rank=1 → 1/61
		// list C: [7]  → id7 rank=1 → 1/61
		// total id7 score = 3/61
		const result = rrfFuse([[7], [7], [7]])
		expect(result).toHaveLength(1)
		expect(result[0].id).toBe(7)
		expect(result[0].score).toBeCloseTo(3 / 61, 10)
	})

	it('custom k parameter overrides default', () => {
		// k=0 would divide by rank; tested with k=10
		// id=1, rank=1 → 1/(10+1) = 1/11
		const result = rrfFuse([[1]], 10)
		expect(result[0].score).toBeCloseTo(1 / 11, 10)
	})

	it('k <= 0 throws', () => {
		expect(() => rrfFuse([[1]], 0)).toThrow()
		expect(() => rrfFuse([[1]], -5)).toThrow()
	})
})
