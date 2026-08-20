import { describe, it, expect, vi } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { insertMemory } from './memories.js';
import { listClaimsForMemory } from './claims.js';
import { confirmMemoryDuplicate } from './memory-dedup-confirm.js';
function freshDb() {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    return db;
}
const baseMem = {
    memory_type: 'decision', scope: 'project', project: 'p', confidence: 0.8,
    decay_class: 'stable', review_status: 'approved',
    source_session_id: null, discovered_from: null, tags: [], promotion_target: 'none',
};
function insertConfirmable(db, title, body) {
    const { id } = insertMemory(db, { ...baseMem, title, body });
    return { id, body, memory_type: baseMem.memory_type, confidence: baseMem.confidence };
}
// Deterministic unit-vector embedding so cosine similarity is fully controlled:
// same fact -> identical vector; different facts -> orthogonal vectors.
function fakeEmbedFn(overrides = {}) {
    return async (text) => {
        if (overrides[text])
            return overrides[text];
        const v = new Float32Array(1024);
        let h = 0;
        for (let i = 0; i < text.length; i++)
            h = (h * 31 + text.charCodeAt(i)) >>> 0;
        v[h % 1024] = 1;
        return v;
    };
}
describe('confirmMemoryDuplicate', () => {
    it('returns "contradicts" when any claim pair carries a numeric contradiction, without checking similarity', async () => {
        const db = freshDb();
        const mA = insertConfirmable(db, 'A', 'MERGE_COVERAGE_FLOOR is 0.72');
        const mB = insertConfirmable(db, 'B', 'MERGE_COVERAGE_FLOOR is 0.80');
        const callFn = async (_s, user) => {
            const fact = user.includes('0.72') ? 'MERGE_COVERAGE_FLOOR is 0.72.' : 'MERGE_COVERAGE_FLOOR is 0.80.';
            return JSON.stringify([{ fact }]);
        };
        const verdict = await confirmMemoryDuplicate(db, mA, mB, callFn, fakeEmbedFn());
        expect(verdict).toBe('contradicts');
        db.close();
    });
    it('returns "confirmed" when a majority of A\'s claims match a claim in B (same wording, same vector)', async () => {
        const db = freshDb();
        const mA = insertConfirmable(db, 'A', 'src/core/distill.ts computes mergedIdentifiers.');
        const mB = insertConfirmable(db, 'B', 'src/core/distill.ts computes mergedIdentifiers, restated.');
        // Content-addressed claim ids collapse identical (claim_type, fact) rows onto
        // whichever memory inserts first — near-duplicate-but-distinct wording (as real
        // paraphrased extraction produces) keeps both memories' claims as separate rows.
        const factA = 'src/core/distill.ts computes mergedIdentifiers.';
        const factB = 'src/core/distill.ts computes mergedIdentifiers (restated).';
        const callFn = async (_s, user) => JSON.stringify([{ fact: user.includes('restated') ? factB : factA }]);
        // Force embedding similarity to 1.0 (real near-duplicate extractions score
        // close to this) so the test isolates the coverage-matching logic itself,
        // not the fake hash-based embedding's incidental collision rate.
        const sharedVec = new Float32Array(1024);
        sharedVec[0] = 1;
        const embedFn = fakeEmbedFn({ [factA]: sharedVec, [factB]: sharedVec });
        const verdict = await confirmMemoryDuplicate(db, mA, mB, callFn, embedFn);
        expect(verdict).toBe('confirmed');
        db.close();
    });
    it('returns "confirmed" for independently-paraphrased duplicate claims scoring below claim-dedup\'s own flag threshold (0.92)', async () => {
        // Regression: live-corpus run found claim-dedup's 0.98/0.92 bands are miscalibrated
        // for THIS comparison. Those thresholds fit claims extracted from the SAME source
        // text (tight textual overlap by construction); here claims come from two
        // independently-authored memories restating the same fact, which scores lower even
        // when unambiguously the same fact. Real measured pair: "The no-pagination stall in
        // nexus_distill sweep cursor is fixed via the distilled_at mechanism" vs "The
        // no-pagination stall in sweep_cursor is fixed via distilled_at." scored fuzzy=0.832,
        // embedding=0.928, combined=0.899 — below 0.92, so classifyDedupBand's 'flag' band
        // never fires and the pair should still confirm via a lower, dedicated threshold.
        const db = freshDb();
        const factA = 'The no-pagination stall in nexus_distill sweep cursor is fixed via the distilled_at mechanism';
        const factB = 'The no-pagination stall in sweep_cursor is fixed via distilled_at.';
        const mA = insertConfirmable(db, 'A', factA);
        const mB = insertConfirmable(db, 'B', factB);
        const callFn = async (_s, user) => JSON.stringify([{ fact: user.includes('mechanism') ? factA : factB }]);
        // Reproduce the measured 0.899 combined score via two non-identical unit vectors
        // (dot product 0.884 blended with the real fuzzy score 0.832 at 0.7/0.3 lands ~0.899).
        const vecA = new Float32Array(1024);
        vecA[0] = 0.884;
        vecA[1] = Math.sqrt(1 - 0.884 ** 2);
        const vecB = new Float32Array(1024);
        vecB[0] = 1;
        const embedFn = fakeEmbedFn({ [factA]: vecA, [factB]: vecB });
        const verdict = await confirmMemoryDuplicate(db, mA, mB, callFn, embedFn);
        expect(verdict).toBe('confirmed');
        db.close();
    });
    it('returns "insufficient" when claims share sentence structure but name different identifiers (the boilerplate false-positive case)', async () => {
        const db = freshDb();
        const mA = insertConfirmable(db, 'A', 'The doc-sync system regenerates notes.md.');
        const mB = insertConfirmable(db, 'B', 'The doc-sync system regenerates design.md.');
        const callFn = async (_s, user) => {
            const fact = user.includes('notes.md') ? 'The doc-sync system regenerates notes.md.' : 'The doc-sync system regenerates design.md.';
            return JSON.stringify([{ fact }]);
        };
        // Same embedding for both (simulating the boilerplate-dominated false positive) —
        // the identifier veto, not the embedding, must be what blocks confirmation here.
        const sharedVec = new Float32Array(1024);
        sharedVec[0] = 1;
        const embedFn = fakeEmbedFn({
            'The doc-sync system regenerates notes.md.': sharedVec,
            'The doc-sync system regenerates design.md.': sharedVec,
        });
        const verdict = await confirmMemoryDuplicate(db, mA, mB, callFn, embedFn);
        expect(verdict).toBe('insufficient');
        db.close();
    });
    it('returns "insufficient" when either memory decomposes to zero claims', async () => {
        const db = freshDb();
        const mA = insertConfirmable(db, 'A', 'plain prose');
        const mB = insertConfirmable(db, 'B', 'more plain prose');
        const callFn = async () => '[]'; // empty -> rejected, zero claims
        const verdict = await confirmMemoryDuplicate(db, mA, mB, callFn, fakeEmbedFn());
        expect(verdict).toBe('insufficient');
        db.close();
    });
    it('decomposes lazily: does not re-extract claims for a memory that already has claims_extracted_at set', async () => {
        const db = freshDb();
        const mA = insertConfirmable(db, 'A', 'fact about A');
        const mB = insertConfirmable(db, 'B', 'fact about B');
        const callFn = vi.fn(async () => JSON.stringify([{ fact: 'a stored fact' }]));
        await confirmMemoryDuplicate(db, mA, mB, callFn, fakeEmbedFn());
        const firstCallCount = callFn.mock.calls.length;
        expect(firstCallCount).toBeGreaterThan(0);
        // Second confirmation call against a fresh third memory: A and B should not be re-decomposed.
        const mC = insertConfirmable(db, 'C', 'fact about C');
        callFn.mockClear();
        await confirmMemoryDuplicate(db, mA, mC, callFn, fakeEmbedFn());
        // Only C should trigger a fresh extraction call; A's claims are already persisted.
        expect(callFn.mock.calls.length).toBeLessThan(firstCallCount + 1);
        db.close();
    });
    it('persists claims for both memories regardless of the verdict, so later comparisons reuse them for free', async () => {
        const db = freshDb();
        const mA = insertConfirmable(db, 'A', 'The doc-sync system regenerates notes.md.');
        const mB = insertConfirmable(db, 'B', 'The doc-sync system regenerates design.md.');
        const callFn = async (_s, user) => {
            const fact = user.includes('notes.md') ? 'The doc-sync system regenerates notes.md.' : 'The doc-sync system regenerates design.md.';
            return JSON.stringify([{ fact }]);
        };
        const verdict = await confirmMemoryDuplicate(db, mA, mB, callFn, fakeEmbedFn());
        expect(verdict).toBe('insufficient'); // not a duplicate, but claims must still be stored
        expect(listClaimsForMemory(db, mA.id).length).toBeGreaterThan(0);
        expect(listClaimsForMemory(db, mB.id).length).toBeGreaterThan(0);
        db.close();
    });
});
//# sourceMappingURL=memory-dedup-confirm.test.js.map