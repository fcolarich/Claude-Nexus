import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { detectNumericContradiction, writeContradictionLinks } from './claim-contradiction.js';
describe('detectNumericContradiction', () => {
    it('flags the design doc\'s own example: same subject, different numeric value', () => {
        const result = detectNumericContradiction('MERGE_COVERAGE_FLOOR is 0.72', 'MERGE_COVERAGE_FLOOR is 0.75');
        expect(result).not.toBeNull();
        expect(result.subject).toMatch(/MERGE_COVERAGE_FLOOR/i);
        expect(result.valueA).toBe('0.72');
        expect(result.valueB).toBe('0.75');
    });
    it('does not flag the same subject with the identical value — that is a duplicate, not a contradiction', () => {
        expect(detectNumericContradiction('MERGE_COVERAGE_FLOOR is 0.72', 'MERGE_COVERAGE_FLOOR is 0.72')).toBeNull();
    });
    it('does not flag different subjects even if both carry numeric values', () => {
        expect(detectNumericContradiction('MERGE_COVERAGE_FLOOR is 0.72', 'MAX_CLUSTER is 3')).toBeNull();
    });
    it('does not flag facts with no trailing numeric value on either side', () => {
        expect(detectNumericContradiction('the API uses REST', 'the API uses REST fully')).toBeNull();
    });
    it('is symmetric — order of arguments does not change the verdict, only which side is A/B', () => {
        const ab = detectNumericContradiction('MAX_CLUSTER is 3', 'MAX_CLUSTER is 4');
        const ba = detectNumericContradiction('MAX_CLUSTER is 4', 'MAX_CLUSTER is 3');
        expect(ab).not.toBeNull();
        expect(ba).not.toBeNull();
        expect(ab.valueA).toBe(ba.valueB);
        expect(ab.valueB).toBe(ba.valueA);
    });
    it('is case-insensitive on the subject and tolerant of "=" and ":" separators', () => {
        expect(detectNumericContradiction('max_cluster = 3', 'MAX_CLUSTER: 4')).not.toBeNull();
    });
    it('integer values differing are flagged too, not just decimals', () => {
        const result = detectNumericContradiction('LLM_FAILURE_ABORT is 5', 'LLM_FAILURE_ABORT is 8');
        expect(result).not.toBeNull();
        expect(result.valueA).toBe('5');
        expect(result.valueB).toBe('8');
    });
});
describe('writeContradictionLinks', () => {
    it('writes BOTH directions — a->b and b->a — never just one (DDR-005 bidirectionality)', () => {
        const db = openDatabase(':memory:');
        initializeSchema(db);
        writeContradictionLinks(db, 'claim-a', 'claim-b');
        const ab = db.prepare(`SELECT * FROM memory_links WHERE source_id = ? AND target_id = ? AND link_type = 'contradicts'`).get('claim-a', 'claim-b');
        const ba = db.prepare(`SELECT * FROM memory_links WHERE source_id = ? AND target_id = ? AND link_type = 'contradicts'`).get('claim-b', 'claim-a');
        expect(ab).toBeDefined();
        expect(ba).toBeDefined();
        db.close();
    });
    it('is surfacing-only — never deletes, hides, or supersedes either claim', () => {
        const db = openDatabase(':memory:');
        initializeSchema(db);
        db.prepare(`INSERT INTO claims (id, memory_id, source_memory_id, fact, claim_type) VALUES ('claim-a', 'm1', 'm1', 'MERGE_COVERAGE_FLOOR is 0.72', 'decision')`).run();
        db.prepare(`INSERT INTO claims (id, memory_id, source_memory_id, fact, claim_type) VALUES ('claim-b', 'm1', 'm1', 'MERGE_COVERAGE_FLOOR is 0.75', 'decision')`).run();
        writeContradictionLinks(db, 'claim-a', 'claim-b');
        const a = db.prepare(`SELECT valid_until, fact FROM claims WHERE id = 'claim-a'`).get();
        const b = db.prepare(`SELECT valid_until, fact FROM claims WHERE id = 'claim-b'`).get();
        expect(a.valid_until).toBeNull();
        expect(b.valid_until).toBeNull();
        expect(a.fact).toBe('MERGE_COVERAGE_FLOOR is 0.72');
        expect(b.fact).toBe('MERGE_COVERAGE_FLOOR is 0.75');
        db.close();
    });
    it('is idempotent — calling it twice for the same pair does not throw or duplicate rows', () => {
        const db = openDatabase(':memory:');
        initializeSchema(db);
        writeContradictionLinks(db, 'claim-a', 'claim-b');
        writeContradictionLinks(db, 'claim-a', 'claim-b');
        const count = db.prepare(`SELECT COUNT(*) c FROM memory_links WHERE link_type = 'contradicts'`).get().c;
        expect(count).toBe(2); // exactly the a->b and b->a pair, no duplicates
        db.close();
    });
});
//# sourceMappingURL=claim-contradiction.test.js.map