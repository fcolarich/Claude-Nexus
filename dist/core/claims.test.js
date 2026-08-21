import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { computeClaimId, insertClaim, getClaim, listClaimsForMemory, markClaimInvalid, embedClaim } from './claims.js';
function freshDb() {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    return db;
}
const base = {
    claim_type: 'decision',
    confidence: 0.7,
};
describe('computeClaimId', () => {
    it('is deterministic for the same claim_type + fact', () => {
        expect(computeClaimId('decision', 'MERGE_COVERAGE_FLOOR is 0.72')).toBe(computeClaimId('decision', 'MERGE_COVERAGE_FLOOR is 0.72'));
    });
    it('differs when fact differs', () => {
        expect(computeClaimId('decision', 'A')).not.toBe(computeClaimId('decision', 'B'));
    });
    it('differs when claim_type differs for the same fact', () => {
        expect(computeClaimId('decision', 'A')).not.toBe(computeClaimId('insight', 'A'));
    });
});
describe('insertClaim', () => {
    it('auto-extracts identifiers from the fact when not supplied', () => {
        const db = freshDb();
        const { id } = insertClaim(db, { ...base, memory_id: 'm1', source_memory_id: 'm1', fact: 'MERGE_COVERAGE_FLOOR is set in src/core/distill.ts' });
        const claim = getClaim(db, id);
        expect(claim.identifiers).toContain('MERGE_COVERAGE_FLOOR');
        expect(claim.identifiers).toContain('src/core/distill.ts');
        db.close();
    });
    it('uses caller-supplied identifiers when given, without re-extracting', () => {
        const db = freshDb();
        const { id } = insertClaim(db, { ...base, memory_id: 'm1', source_memory_id: 'm1', fact: 'plain prose, no identifiers here', identifiers: ['CUSTOM_TOKEN'] });
        const claim = getClaim(db, id);
        expect(claim.identifiers).toEqual(['CUSTOM_TOKEN']);
        db.close();
    });
    it('is content-addressed — inserting the same claim_type+fact twice is a no-op the second time', () => {
        const db = freshDb();
        const first = insertClaim(db, { ...base, memory_id: 'm1', source_memory_id: 'm1', fact: 'same fact' });
        const second = insertClaim(db, { ...base, memory_id: 'm2', source_memory_id: 'm2', fact: 'same fact' });
        expect(first.id).toBe(second.id);
        expect(first.inserted).toBe(true);
        expect(second.inserted).toBe(false);
        db.close();
    });
    it('sets valid_from/recorded_at and leaves valid_until/expired_at NULL by default', () => {
        const db = freshDb();
        const { id } = insertClaim(db, { ...base, memory_id: 'm1', source_memory_id: 'm1', fact: 'a fresh claim' });
        const claim = getClaim(db, id);
        expect(claim.valid_from).toBeTruthy();
        expect(claim.recorded_at).toBeTruthy();
        expect(claim.valid_until).toBeNull();
        expect(claim.expired_at).toBeNull();
        db.close();
    });
});
describe('listClaimsForMemory', () => {
    it('returns every claim whose memory_id matches, and none for a different memory', () => {
        const db = freshDb();
        insertClaim(db, { ...base, memory_id: 'm1', source_memory_id: 'm1', fact: 'claim one' });
        insertClaim(db, { ...base, memory_id: 'm1', source_memory_id: 'm1', fact: 'claim two' });
        insertClaim(db, { ...base, memory_id: 'm2', source_memory_id: 'm2', fact: 'claim three' });
        const claims = listClaimsForMemory(db, 'm1');
        expect(claims).toHaveLength(2);
        expect(claims.every((c) => c.memory_id === 'm1')).toBe(true);
        db.close();
    });
    it('by default excludes claims already marked invalid', () => {
        const db = freshDb();
        const { id } = insertClaim(db, { ...base, memory_id: 'm1', source_memory_id: 'm1', fact: 'will be invalidated' });
        markClaimInvalid(db, id);
        expect(listClaimsForMemory(db, 'm1')).toHaveLength(0);
        expect(listClaimsForMemory(db, 'm1', { includeInvalid: true })).toHaveLength(1);
        db.close();
    });
});
describe('markClaimInvalid', () => {
    it('sets valid_until and expired_at, never touches fact', () => {
        const db = freshDb();
        const { id } = insertClaim(db, { ...base, memory_id: 'm1', source_memory_id: 'm1', fact: 'original immutable fact' });
        const ok = markClaimInvalid(db, id);
        expect(ok).toBe(true);
        const claim = getClaim(db, id);
        expect(claim.fact).toBe('original immutable fact');
        expect(claim.valid_until).not.toBeNull();
        expect(claim.expired_at).not.toBeNull();
        db.close();
    });
    it('writes a directional supersedes edge from the new claim to the invalidated one, when given', () => {
        const db = freshDb();
        const { id: oldId } = insertClaim(db, { ...base, memory_id: 'm1', source_memory_id: 'm1', fact: 'MERGE_COVERAGE_FLOOR is 0.72' });
        const { id: newId } = insertClaim(db, { ...base, memory_id: 'm1', source_memory_id: 'm1', fact: 'MERGE_COVERAGE_FLOOR is 0.75' });
        markClaimInvalid(db, oldId, newId);
        const edge = db.prepare(`SELECT * FROM memory_links WHERE source_id = ? AND target_id = ? AND link_type = 'supersedes'`).get(newId, oldId);
        expect(edge).toBeDefined();
        db.close();
    });
    it('returns false for an id that does not exist', () => {
        const db = freshDb();
        expect(markClaimInvalid(db, 'nonexistent')).toBe(false);
        db.close();
    });
    it('is idempotent — invalidating an already-invalid claim a second time does not throw and does not move the timestamp', () => {
        const db = freshDb();
        const { id } = insertClaim(db, { ...base, memory_id: 'm1', source_memory_id: 'm1', fact: 'a claim' });
        markClaimInvalid(db, id);
        const first = getClaim(db, id).valid_until;
        const second = markClaimInvalid(db, id);
        expect(second).toBe(false);
        expect(getClaim(db, id).valid_until).toBe(first);
        db.close();
    });
});
describe('embedClaim', () => {
    const fakeEmbed = async (_text) => new Float32Array(1024).fill(0.1);
    it('stores a normalized vector in claims_vec, keyed by rowid', async () => {
        const db = freshDb();
        const { id } = insertClaim(db, { ...base, memory_id: 'm1', source_memory_id: 'm1', fact: 'a claim to embed' });
        const ok = await embedClaim(db, id, fakeEmbed);
        expect(ok).toBe(true);
        const row = db.prepare(`SELECT c.rowid FROM claims c WHERE c.id = ?`).get(id);
        const vec = db.prepare(`SELECT embedding FROM claims_vec WHERE rowid = ?`).get(row.rowid);
        expect(vec).toBeDefined();
        db.close();
    });
    it('returns false for an id that does not exist', async () => {
        const db = freshDb();
        expect(await embedClaim(db, 'nonexistent', fakeEmbed)).toBe(false);
        db.close();
    });
    it('returns false when the embed function yields null (embedding backend unavailable)', async () => {
        const db = freshDb();
        const { id } = insertClaim(db, { ...base, memory_id: 'm1', source_memory_id: 'm1', fact: 'a claim' });
        expect(await embedClaim(db, id, async () => null)).toBe(false);
        db.close();
    });
});
//# sourceMappingURL=claims.test.js.map