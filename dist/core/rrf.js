// Reciprocal Rank Fusion — pure math helper, no DB or embedding imports.
// Score for an id = sum over each ranked list of 1/(k + rank), where rank is 1-indexed.
// An id absent from a list contributes 0 (no term added).
// If an id appears more than once in a single list, only its first (best) position is used.
// k <= 0: throws — division by zero or negative denominator has no meaningful interpretation here.
export const RRF_K = 60;
export function rrfFuse(rankedLists, k = RRF_K) {
    if (k <= 0)
        throw new RangeError(`rrfFuse: k must be > 0, got ${k}`);
    const scores = new Map();
    for (const list of rankedLists) {
        const seen = new Set();
        let rank = 1;
        for (const id of list) {
            if (!seen.has(id)) {
                seen.add(id);
                const contribution = 1 / (k + rank);
                scores.set(id, (scores.get(id) ?? 0) + contribution);
            }
            // rank always advances — duplicate ids still occupy a position in the list
            rank++;
        }
    }
    return Array.from(scores.entries())
        .map(([id, score]) => ({ id, score }))
        .sort((a, b) => b.score - a.score);
}
//# sourceMappingURL=rrf.js.map