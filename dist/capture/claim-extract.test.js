import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema } from '../core/database.js';
import { insertMemory } from '../core/memories.js';
import { listClaimsForMemory } from '../core/claims.js';
import { missingIdentifiers, claimExtractPrompt, extractClaimsForMemory } from './claim-extract.js';
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
describe('missingIdentifiers', () => {
    it('returns identifiers in the source text absent from every claim fact', () => {
        const missing = missingIdentifiers('Uses src/core/distill.ts and MERGE_COVERAGE_FLOOR', ['A claim about src/core/distill.ts']);
        expect(missing).toContain('MERGE_COVERAGE_FLOOR');
        expect(missing).not.toContain('src/core/distill.ts');
    });
    it('returns an empty array when every source identifier is covered across all claims', () => {
        const missing = missingIdentifiers('Uses src/core/distill.ts and MERGE_COVERAGE_FLOOR', ['A claim about src/core/distill.ts', 'Another claim about MERGE_COVERAGE_FLOOR']);
        expect(missing).toEqual([]);
    });
    it('returns an empty array when the source text has no identifiers at all', () => {
        expect(missingIdentifiers('just plain English prose', ['a claim'])).toEqual([]);
    });
});
describe('claimExtractPrompt', () => {
    it('names the missing identifiers as data when retrying, per DDR-20260808153651-39', () => {
        const prompt = claimExtractPrompt(['MERGE_COVERAGE_FLOOR', 'src/core/distill.ts']);
        expect(prompt).toContain('MERGE_COVERAGE_FLOOR');
        expect(prompt).toContain('src/core/distill.ts');
    });
    it('has no missing-identifier section on the first attempt', () => {
        const prompt = claimExtractPrompt();
        expect(prompt).not.toContain('did not mention');
    });
});
describe('extractClaimsForMemory', () => {
    it('inserts one claim per fact the model returns, typed from the parent memory_type', async () => {
        const db = freshDb();
        const mem = insertMemory(db, { ...baseMem, title: 'M', body: 'Uses src/core/distill.ts and MERGE_COVERAGE_FLOOR is 0.72' });
        const callFn = async () => JSON.stringify([
            { fact: 'The system uses src/core/distill.ts for merge logic.' },
            { fact: 'MERGE_COVERAGE_FLOOR is 0.72.' },
        ]);
        const result = await extractClaimsForMemory(db, { id: mem.id, body: 'Uses src/core/distill.ts and MERGE_COVERAGE_FLOOR is 0.72', memory_type: 'decision', confidence: 0.8 }, callFn);
        expect(result.rejected).toBe(false);
        expect(result.claims).toHaveLength(2);
        expect(result.claims.every((c) => c.claim_type === 'decision')).toBe(true);
        const stored = listClaimsForMemory(db, mem.id);
        expect(stored).toHaveLength(2);
        db.close();
    });
    it('retries once with the missing identifiers named, and succeeds on the retry', async () => {
        const db = freshDb();
        const mem = insertMemory(db, { ...baseMem, title: 'M', body: 'Uses src/core/distill.ts and MERGE_COVERAGE_FLOOR' });
        let calls = 0;
        const callFn = async (_system, user) => {
            calls++;
            if (calls === 1) {
                // Drops MERGE_COVERAGE_FLOOR entirely — triggers a retry.
                return JSON.stringify([{ fact: 'Uses src/core/distill.ts for merge logic.' }]);
            }
            expect(user).toContain('MERGE_COVERAGE_FLOOR');
            return JSON.stringify([
                { fact: 'Uses src/core/distill.ts for merge logic.' },
                { fact: 'MERGE_COVERAGE_FLOOR is the coverage gate threshold.' },
            ]);
        };
        const result = await extractClaimsForMemory(db, { id: mem.id, body: 'Uses src/core/distill.ts and MERGE_COVERAGE_FLOOR', memory_type: 'decision', confidence: 0.8 }, callFn);
        expect(calls).toBe(2);
        expect(result.rejected).toBe(false);
        expect(result.claims.length).toBeGreaterThanOrEqual(2);
        db.close();
    });
    it('rejects and writes NO claims after exhausting retries — never a partial write', async () => {
        const db = freshDb();
        const mem = insertMemory(db, { ...baseMem, title: 'M', body: 'Uses src/core/distill.ts and MERGE_COVERAGE_FLOOR' });
        const callFn = async () => JSON.stringify([{ fact: 'Uses src/core/distill.ts for merge logic.' }]); // always drops MERGE_COVERAGE_FLOOR
        const result = await extractClaimsForMemory(db, { id: mem.id, body: 'Uses src/core/distill.ts and MERGE_COVERAGE_FLOOR', memory_type: 'decision', confidence: 0.8 }, callFn);
        expect(result.rejected).toBe(true);
        expect(result.claims).toHaveLength(0);
        expect(listClaimsForMemory(db, mem.id)).toHaveLength(0);
        db.close();
    });
    it('rejects on an unparseable response rather than throwing', async () => {
        const db = freshDb();
        const mem = insertMemory(db, { ...baseMem, title: 'M', body: 'plain prose' });
        const callFn = async () => 'not json at all';
        const result = await extractClaimsForMemory(db, { id: mem.id, body: 'plain prose', memory_type: 'decision', confidence: 0.8 }, callFn);
        expect(result.rejected).toBe(true);
        expect(result.claims).toHaveLength(0);
        db.close();
    });
});
//# sourceMappingURL=claim-extract.test.js.map