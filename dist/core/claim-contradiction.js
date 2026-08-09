/**
 * Numeric contradiction guard (q-011, _documents/design-structured-memory.md).
 *
 * INFERENCE — no prior art in any source consulted for this design. The closest
 * analogs are Graphiti routing high-similarity-but-conflicting pairs to
 * invalidation rather than merge, and a "hard-conflict guard no similarity
 * score can override" referenced in entity-resolution literature. This is a
 * hypothesis requiring its own empirical validation, not an assumed-correct
 * design (see DDR-20260808153555-7a and the design doc's Consolidation
 * Semantics section).
 *
 * Deterministic, code-only, runs BEFORE similarity scoring: two claims about
 * the same subject with different numeric values are a contradiction
 * candidate, never a duplicate, regardless of how close their embeddings are.
 */
// Subject := everything before a trailing "is <number>" / "= <number>" / ": <number>",
// optionally followed by a period. Value := the trailing integer or decimal.
const TRAILING_VALUE_RE = /^(.*?)\s*(?:is|=|:)\s*(-?\d+(?:\.\d+)?)\s*\.?\s*$/i;
function normalizeSubject(subject) {
    return subject.trim().toLowerCase().replace(/\s+/g, ' ');
}
/**
 * Returns the contradiction (subject + both values) if factA and factB name
 * the same subject with different numeric values, else null. Equal values
 * are NOT a contradiction — that is a duplicate, which the dedup cascade
 * handles separately.
 */
export function detectNumericContradiction(factA, factB) {
    const matchA = factA.match(TRAILING_VALUE_RE);
    const matchB = factB.match(TRAILING_VALUE_RE);
    if (!matchA || !matchB)
        return null;
    const [, subjectA, valueA] = matchA;
    const [, subjectB, valueB] = matchB;
    if (normalizeSubject(subjectA) !== normalizeSubject(subjectB))
        return null;
    if (valueA === valueB)
        return null;
    return { subject: subjectA.trim(), valueA, valueB };
}
/**
 * Write a bidirectional `contradicts` pair (a->b and b->a) between two claims,
 * per DDR-005's bidirectionality rule (symmetric lookups from either endpoint).
 * Surfacing-only: never deletes, hides, or supersedes either claim — a human
 * or a later claim resolves it. Idempotent (INSERT OR IGNORE on the same
 * UNIQUE(source_id, target_id, link_type) memory_links already enforces).
 */
export function writeContradictionLinks(db, claimIdA, claimIdB) {
    const link = db.prepare(`INSERT OR IGNORE INTO memory_links (source_id, target_id, link_type, confidence) VALUES (?, ?, 'contradicts', 1.0)`);
    link.run(claimIdA, claimIdB);
    link.run(claimIdB, claimIdA);
}
//# sourceMappingURL=claim-contradiction.js.map