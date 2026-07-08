import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { openDatabase, initializeSchema } from './database.js';
import { insertMemory, rememberBatch, getMemory } from './memories.js';
/** Minimal in-memory DB with schema, no embedding (embed injected as no-op). */
function freshDb() {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    return db;
}
const noEmbed = async () => false; // skip embedding in unit tests
function item(overrides = {}) {
    return {
        title: 'T',
        body: 'unique body ' + Math.random(),
        memory_type: 'reference',
        scope: 'global',
        project: null,
        confidence: 0.85,
        decay_class: 'stable',
        review_status: 'approved',
        source_session_id: null,
        discovered_from: null,
        tags: [],
        promotion_target: 'none',
        load_at_init: false,
        ...overrides,
    };
}
describe('rememberBatch', () => {
    it('reports written vs duplicate per item', async () => {
        const db = freshDb();
        const a = item({ body: 'body-A' });
        const b = item({ body: 'body-B' });
        const res = await rememberBatch(db, [a, b, a], noEmbed);
        expect(res.results.map(r => r.status)).toEqual(['written', 'written', 'duplicate']);
        expect(res.results[0].id).toBeTruthy();
        expect(res.results[2].id).toBe(res.results[0].id); // content-addressed dedup
        db.close();
    });
    it('one throwing item does not abort the rest', async () => {
        const db = freshDb();
        // body null throws inside insertMemory (computeMemoryId/contentHash call body.trim())
        // before any SQL runs — INSERT OR IGNORE would silently swallow a constraint violation,
        // so we force a real throw to exercise the per-item catch path.
        const bad = item({ body: null });
        const good = item({ body: 'body-good' });
        const res = await rememberBatch(db, [bad, good], noEmbed);
        expect(res.results[0].status).toBe('error');
        expect(res.results[0].reason).toBeTruthy();
        expect(res.results[1].status).toBe('written');
        // the good one is actually persisted
        expect(getMemory(db, res.results[1].id)).toBeTruthy();
        db.close();
    });
    it('embeds each written item best-effort', async () => {
        const db = freshDb();
        const embedded = [];
        const embed = async (id) => { embedded.push(id); return true; };
        const res = await rememberBatch(db, [item({ body: 'e1' }), item({ body: 'e2' })], embed);
        expect(embedded.sort()).toEqual(res.results.map(r => r.id).sort());
        db.close();
    });
});
describe('insertMemory promotion_target round-trip', () => {
    it('persists promotion_target and leaves promoted_to null', () => {
        const db = freshDb();
        const input = {
            title: 'ADR candidate',
            body: 'some architecture decision body',
            memory_type: 'decision',
            scope: 'project',
            project: 'test-project',
            confidence: 0.9,
            decay_class: 'stable',
            review_status: 'approved',
            source_session_id: null,
            discovered_from: null,
            tags: [],
            promotion_target: 'adr',
            load_at_init: false,
        };
        const { id, inserted } = insertMemory(db, input);
        expect(inserted).toBe(true);
        const mem = getMemory(db, id);
        expect(mem).toBeTruthy();
        expect(mem.promotion_target).toBe('adr');
        expect(mem.promoted_to).toBeNull();
        db.close();
    });
});
describe('nexus_remember_batch schema contract', () => {
    // Mirror of the tool's array constraint — locks the 1..50 bound.
    const memoriesSchema = z.array(z.object({ title: z.string(), content: z.string() })).min(1).max(50);
    it('rejects an empty batch', () => {
        expect(memoriesSchema.safeParse([]).success).toBe(false);
    });
    it('accepts exactly 50', () => {
        const fifty = Array.from({ length: 50 }, (_, i) => ({ title: `t${i}`, content: `c${i}` }));
        expect(memoriesSchema.safeParse(fifty).success).toBe(true);
    });
    it('rejects 51', () => {
        const fiftyOne = Array.from({ length: 51 }, (_, i) => ({ title: `t${i}`, content: `c${i}` }));
        expect(memoriesSchema.safeParse(fiftyOne).success).toBe(false);
    });
});
//# sourceMappingURL=memories.test.js.map