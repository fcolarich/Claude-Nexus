/**
 * TDD red: specifies the parity gate contract before scripts/parity-gates.mjs exists.
 * All tests must fail with "module not found" or "not implemented" — not an import syntax error.
 * D-014: embedding cosine >= 0.9990, dim === 1024; rerank |Δscore| <= 1e-3 AND identical order.
 */

import { describe, it, expect } from 'vitest';
import {
	cosine,
	COSINE_THRESHOLD,
	EXPECTED_DIM,
	SCORE_DELTA_THRESHOLD,
	checkEmbedding,
	checkRerank,
} from '../scripts/parity-gates.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a unit vector with 1.0 in position 0, zeros elsewhere (1024-dim). */
function unitVec(): number[] {
	const v = new Array(1024).fill(0);
	v[0] = 1;
	return v;
}

/** Normalise an array to unit length. */
function normalise(v: number[]): number[] {
	const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
	return v.map(x => x / mag);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('exported constants', () => {
	it('COSINE_THRESHOLD is 0.9990', () => {
		expect(COSINE_THRESHOLD).toBe(0.9990);
	});

	it('EXPECTED_DIM is 1024', () => {
		expect(EXPECTED_DIM).toBe(1024);
	});

	it('SCORE_DELTA_THRESHOLD is 1e-3', () => {
		expect(SCORE_DELTA_THRESHOLD).toBe(1e-3);
	});
});

// ---------------------------------------------------------------------------
// cosine() primitive
// ---------------------------------------------------------------------------

describe('cosine()', () => {
	it('identical vectors → exactly 1.0', () => {
		const v = unitVec();
		expect(cosine(v, v)).toBe(1.0);
	});

	it('orthogonal vectors → 0', () => {
		const a = unitVec();
		const b = new Array(1024).fill(0);
		b[1] = 1;
		expect(cosine(a, b)).toBeCloseTo(0, 10);
	});

	it('computes correct cosine for known geometry', () => {
		// v1 = [1, 0, ...], v2 = [0.8, 0.6, 0, ...] → cosine = 0.8
		const v1 = unitVec();
		const v2 = new Array(1024).fill(0);
		v2[0] = 0.8;
		v2[1] = 0.6;
		expect(cosine(v1, v2)).toBeCloseTo(0.8, 10);
	});
});

// ---------------------------------------------------------------------------
// checkEmbedding() — embedding parity gate
// ---------------------------------------------------------------------------

describe('checkEmbedding()', () => {
	it('identical vectors pass', () => {
		const v = unitVec();
		const result = checkEmbedding(v, v);
		expect(result.pass).toBe(true);
	});

	it('cosine >= 0.9990 passes — tight but above threshold', () => {
		// v1 = [1, 0, ...], v2 = [0.9995, ε, 0, ...] normalised → cosine ≈ 0.9995
		const v1 = unitVec();
		const v2 = normalise([0.9995, Math.sqrt(1 - 0.9995 ** 2), ...new Array(1022).fill(0)]);
		const result = checkEmbedding(v1, v2);
		expect(result.pass).toBe(true);
	});

	it('cls-vs-mean geometry perturbation (cosine ~0.8) FAILS — guards against pooling corruption', () => {
		// cosine([1,0,...], [0.8, 0.6, 0,...]) = 0.8 — representative of --pooling cls vs mean shift
		const v1 = unitVec();
		const v2 = new Array(1024).fill(0);
		v2[0] = 0.8;
		v2[1] = 0.6;
		const result = checkEmbedding(v1, v2);
		expect(result.pass).toBe(false);
	});

	it('dim mismatch (512) fails on dimension check — not on cosine', () => {
		const v1 = unitVec();
		const v2 = new Array(512).fill(0);
		v2[0] = 1;
		const result = checkEmbedding(v1, v2);
		expect(result.pass).toBe(false);
		// reason must mention dim, not cosine
		expect(result.reason).toMatch(/dim/i);
	});

	it('dim mismatch (2048) fails on dimension check — not on cosine', () => {
		const v1 = unitVec();
		const v2 = new Array(2048).fill(0);
		v2[0] = 1;
		const result = checkEmbedding(v1, v2);
		expect(result.pass).toBe(false);
		expect(result.reason).toMatch(/dim/i);
	});

	it('zero vector fails explicitly — not silently via NaN >= threshold evaluating false', () => {
		const v1 = unitVec();
		const v2 = new Array(1024).fill(0);
		const result = checkEmbedding(v1, v2);
		expect(result.pass).toBe(false);
		expect(result.reason).toMatch(/zero|nan|invalid/i);
	});

	it('NaN-bearing vector fails explicitly — not silently via NaN >= threshold evaluating false', () => {
		const v1 = unitVec();
		const v2 = unitVec();
		v2[5] = NaN;
		const result = checkEmbedding(v1, v2);
		expect(result.pass).toBe(false);
		expect(result.reason).toMatch(/nan|invalid/i);
	});
});

// ---------------------------------------------------------------------------
// checkRerank() — reranker parity gate
// ---------------------------------------------------------------------------

type RankEntry = { id: string; score: number };

describe('checkRerank()', () => {
	it('identical results (order + scores) pass', () => {
		const baseline: RankEntry[] = [
			{ id: 'a', score: 0.9 },
			{ id: 'b', score: 0.7 },
			{ id: 'c', score: 0.5 },
		];
		const result = checkRerank(baseline, [...baseline]);
		expect(result.pass).toBe(true);
	});

	it('|Δscore| = 1e-4 passes (below 1e-3 threshold)', () => {
		const baseline: RankEntry[] = [
			{ id: 'a', score: 0.9000 },
			{ id: 'b', score: 0.7000 },
		];
		const current: RankEntry[] = [
			{ id: 'a', score: 0.9001 },  // delta = 1e-4
			{ id: 'b', score: 0.7001 },  // delta = 1e-4
		];
		const result = checkRerank(baseline, current);
		expect(result.pass).toBe(true);
	});

	it('|Δscore| = 1e-2 fails (above 1e-3 threshold)', () => {
		const baseline: RankEntry[] = [
			{ id: 'a', score: 0.9 },
			{ id: 'b', score: 0.7 },
		];
		const current: RankEntry[] = [
			{ id: 'a', score: 0.91 },  // delta = 1e-2
			{ id: 'b', score: 0.71 },  // delta = 1e-2
		];
		const result = checkRerank(baseline, current);
		expect(result.pass).toBe(false);
	});

	it('a single swapped adjacent pair fails order equality — equal scores isolate order check from score-delta', () => {
		// Scores are identical so a score-delta check cannot be the reason for failure.
		// Only an order/position check can produce the failure, which is what we want to assert.
		const baseline: RankEntry[] = [
			{ id: 'a', score: 0.8 },
			{ id: 'b', score: 0.8 },
			{ id: 'c', score: 0.7 },
		];
		const current: RankEntry[] = [
			{ id: 'b', score: 0.8 },  // adjacent pair a/b swapped
			{ id: 'a', score: 0.8 },
			{ id: 'c', score: 0.7 },
		];
		const result = checkRerank(baseline, current);
		expect(result.pass).toBe(false);
		expect(result.reason).toMatch(/order/i);
	});

	it('equal scores in different positions fail order equality', () => {
		// Same scores, different id order — order equality must still be checked by id position.
		const baseline: RankEntry[] = [
			{ id: 'a', score: 0.8 },
			{ id: 'b', score: 0.8 },
		];
		const current: RankEntry[] = [
			{ id: 'b', score: 0.8 },
			{ id: 'a', score: 0.8 },
		];
		const result = checkRerank(baseline, current);
		expect(result.pass).toBe(false);
	});
});
