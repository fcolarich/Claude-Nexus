/**
 * Parity gate math for model coresidency verification.
 * Zero I/O, zero side effects. Thresholds are non-negotiable at run time (D-014).
 */

export const COSINE_THRESHOLD = 0.9990;
export const EXPECTED_DIM = 1024;
export const SCORE_DELTA_THRESHOLD = 1e-3;

/**
 * Cosine similarity between two equal-length float64 arrays.
 * Returns NaN if either vector has zero magnitude.
 * Does NOT guard against NaN inputs — callers must pre-validate.
 */
export function cosine(a, b) {
	let dot = 0;
	let magA = 0;
	let magB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		magA += a[i] * a[i];
		magB += b[i] * b[i];
	}
	magA = Math.sqrt(magA);
	magB = Math.sqrt(magB);
	if (magA === 0 || magB === 0) return NaN;
	return dot / (magA * magB);
}

/**
 * Checks whether a vector has any NaN elements.
 */
function hasNaN(v) {
	for (let i = 0; i < v.length; i++) {
		if (Number.isNaN(v[i])) return true;
	}
	return false;
}

/**
 * Embedding parity gate.
 * Returns {pass: true} or {pass: false, reason: string}.
 * Checks in order: NaN → dim → cosine.
 */
export function checkEmbedding(baseline, current) {
	if (hasNaN(baseline) || hasNaN(current)) {
		return { pass: false, reason: 'NaN element detected in embedding vector' };
	}
	if (baseline.length !== EXPECTED_DIM || current.length !== EXPECTED_DIM) {
		return {
			pass: false,
			reason: `dim mismatch: expected ${EXPECTED_DIM}, got baseline=${baseline.length} current=${current.length}`,
		};
	}
	const sim = cosine(baseline, current);
	if (Number.isNaN(sim)) {
		return { pass: false, reason: 'zero-magnitude vector — cosine undefined (NaN)' };
	}
	if (sim < COSINE_THRESHOLD) {
		return { pass: false, reason: `cosine ${sim.toFixed(6)} below threshold ${COSINE_THRESHOLD}` };
	}
	return { pass: true };
}

/**
 * Reranker parity gate.
 * baseline and current are arrays of {id: string, score: number}.
 * Checks order equality first, then per-entry score delta.
 * Returns {pass: true} or {pass: false, reason: string}.
 */
export function checkRerank(baseline, current) {
	if (baseline.length !== current.length) {
		return {
			pass: false,
			reason: `length mismatch: baseline=${baseline.length} current=${current.length}`,
		};
	}
	for (let i = 0; i < baseline.length; i++) {
		if (baseline[i].id !== current[i].id) {
			return {
				pass: false,
				reason: `order mismatch at position ${i}: expected id="${baseline[i].id}" got "${current[i].id}"`,
			};
		}
	}
	for (let i = 0; i < baseline.length; i++) {
		const delta = Math.abs(baseline[i].score - current[i].score);
		if (delta > SCORE_DELTA_THRESHOLD) {
			return {
				pass: false,
				reason: `score delta ${delta.toExponential(2)} at id="${baseline[i].id}" exceeds threshold ${SCORE_DELTA_THRESHOLD}`,
			};
		}
	}
	return { pass: true };
}
