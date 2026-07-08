import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { insertMemory, verifyMemory, recordFeedback, getMemory } from './memories.js';
import { consolidateMemories } from './consolidate.js';
function freshDb() {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    return db;
}
const base = {
    memory_type: 'convention', scope: 'project', project: 'p', confidence: 0.6,
    decay_class: 'stable', review_status: 'approved',
    source_session_id: null, discovered_from: null, tags: [], promotion_target: 'none',
};
/** Constant embedder — every memory embeds identically, so all are near-dups. */
const constVec = () => { const v = new Float32Array(1024); v.fill(0.1); return v; };
describe('verifyMemory', () => {
    it('bumps confidence and resets the decay clock', () => {
        const db = freshDb();
        const { id } = insertMemory(db, { ...base, title: 'M', body: 'a memory', confidence: 0.5 });
        db.prepare(`UPDATE memories SET last_verified_at = '2000-01-01 00:00:00' WHERE id = ?`).run(id);
        expect(verifyMemory(db, id)).toBe(true);
        const m = getMemory(db, id);
        expect(m.confidence).toBeCloseTo(0.6, 5);
        expect(m.last_verified_at > '2020').toBe(true);
        expect(verifyMemory(db, 'no-such-id')).toBe(false);
        db.close();
    });
});
describe('recordFeedback', () => {
    it('tracks use_count and help_count', () => {
        const db = freshDb();
        const { id } = insertMemory(db, { ...base, title: 'M', body: 'a memory' });
        recordFeedback(db, id, true);
        recordFeedback(db, id, false);
        const m = getMemory(db, id);
        expect(m.use_count).toBe(2);
        expect(m.help_count).toBe(1);
        db.close();
    });
});
describe('consolidateMemories', () => {
    it('prunes rejected memories', async () => {
        const db = freshDb();
        insertMemory(db, { ...base, title: 'Keep', body: 'keep this one', review_status: 'approved' });
        insertMemory(db, { ...base, title: 'Drop', body: 'reject this one', review_status: 'rejected' });
        const r = await consolidateMemories(db, async () => null); // no embedder -> no merges
        expect(r.pruned).toBe(1);
        expect(db.prepare(`SELECT COUNT(*) c FROM memories`).get().c).toBe(1);
        db.close();
    });
    it('merges near-duplicates, superseding the lower-confidence memory', async () => {
        const db = freshDb();
        const a = insertMemory(db, { ...base, title: 'A', body: 'first phrasing of the rule', confidence: 0.9 });
        const b = insertMemory(db, { ...base, title: 'B', body: 'second phrasing of the rule', confidence: 0.7 });
        const r = await consolidateMemories(db, async () => constVec());
        expect(r.merged).toBe(1);
        expect(getMemory(db, a.id).superseded_by).toBeNull();
        expect(getMemory(db, b.id).superseded_by).toBe(a.id);
        db.close();
    });
});
//# sourceMappingURL=lifecycle.test.js.map