/**
 * Tests for nexus_promotions and nexus_mark_promoted tool logic.
 *
 * Approach A: exercise the underlying SQL + update logic against an isolated
 * :memory: DB seeded via insertMemory/getMemory — no server import, no real DB.
 * Mirrors the precedent in src/core/memories.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema } from '../core/database.js';
import { insertMemory, getMemory } from '../core/memories.js';
import { extractIdentifiers, unionIdentifiers } from '../core/identifiers.js';
function freshDb() {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    return db;
}
const noEmbed = async (_id) => false;
/** Base memory input — override individual fields per test. */
function memInput(overrides = {}) {
    return {
        title: 'Test memory',
        body: 'Some architectural decision body ' + Math.random(),
        memory_type: 'decision',
        scope: 'project',
        project: 'test-proj',
        confidence: 0.9,
        decay_class: 'stable',
        review_status: 'approved',
        source_session_id: null,
        discovered_from: null,
        tags: [],
        promotion_target: 'adr',
        load_at_init: false,
        ...overrides,
    };
}
// ── nexus_promotions query logic ──────────────────────────────────────
/**
 * Runs the exact SQL from the nexus_promotions handler against the given db.
 * Optional project/target filters mirror what the tool does.
 */
function queryPromotionCandidates(db, opts = {}) {
    let sql = `SELECT id, title, body, confidence, source_session_id, promotion_target
               FROM memories
               WHERE promotion_target != 'none'
                 AND promoted_to IS NULL
                 AND review_status != 'rejected'
                 AND superseded_by IS NULL`;
    const params = [];
    if (opts.project) {
        sql += ` AND project = ?`;
        params.push(opts.project);
    }
    if (opts.target) {
        sql += ` AND promotion_target = ?`;
        params.push(opts.target);
    }
    sql += ` ORDER BY promotion_target, confidence DESC`;
    return db.prepare(sql).all(...params);
}
/**
 * Runs the exact body-rewrite + UPDATE from the nexus_mark_promoted handler.
 * Returns the success text or an error string, mirroring the tool's content[0].text.
 */
async function runMarkPromoted(db, id, artifact_ref, embedFn = noEmbed) {
    const memory = getMemory(db, id);
    if (!memory) {
        return `Error: memory not found with id ${id}`;
    }
    // D-006: rewrite body to thin pointer — first sentence → artifact_ref,
    // appending the ref only if it is not already present.
    const firstSentence = memory.body.split(/(?<=[.!?])\s/)[0].trim();
    const newBody = firstSentence && !firstSentence.includes(artifact_ref)
        ? `${firstSentence} → ${artifact_ref}`
        : firstSentence;
    const newIdentifiers = unionIdentifiers(memory.identifiers, extractIdentifiers(newBody));
    db.prepare(`UPDATE memories SET body = ?, promoted_to = ?, identifiers = ?, updated_at = datetime('now') WHERE id = ?`).run(newBody, artifact_ref, JSON.stringify(newIdentifiers), id);
    // D-005: re-embed the rewritten body — best-effort, failure does not fail
    embedFn(id).catch(() => { });
    return `"${memory.title}" marked promoted → ${artifact_ref}`;
}
// ─────────────────────────────────────────────────────────────────────
// Tests: nexus_promotions
// ─────────────────────────────────────────────────────────────────────
describe('nexus_promotions query logic', () => {
    it('includes a valid candidate (promotion_target=adr, promoted_to=NULL, approved, superseded_by=NULL)', () => {
        const db = freshDb();
        const { id } = insertMemory(db, memInput({ promotion_target: 'adr' }));
        const rows = queryPromotionCandidates(db);
        expect(rows.map(r => r.id)).toContain(id);
        db.close();
    });
    it('excludes a memory where promoted_to is already set', () => {
        const db = freshDb();
        const { id } = insertMemory(db, memInput({ promotion_target: 'adr' }));
        db.prepare(`UPDATE memories SET promoted_to = 'ADR-001' WHERE id = ?`).run(id);
        const rows = queryPromotionCandidates(db);
        expect(rows.map(r => r.id)).not.toContain(id);
        db.close();
    });
    it('excludes a memory with review_status=rejected', () => {
        const db = freshDb();
        const { id } = insertMemory(db, memInput({ promotion_target: 'adr', review_status: 'rejected' }));
        const rows = queryPromotionCandidates(db);
        expect(rows.map(r => r.id)).not.toContain(id);
        db.close();
    });
    it('excludes a memory where superseded_by is set', () => {
        const db = freshDb();
        const { id } = insertMemory(db, memInput({ promotion_target: 'adr' }));
        const { id: supersedingId } = insertMemory(db, memInput({ body: 'the superseding memory.', promotion_target: 'adr' }));
        db.prepare(`UPDATE memories SET superseded_by = ? WHERE id = ?`).run(supersedingId, id);
        const rows = queryPromotionCandidates(db);
        expect(rows.map(r => r.id)).not.toContain(id);
        db.close();
    });
    it('excludes a memory with promotion_target=none', () => {
        const db = freshDb();
        const { id } = insertMemory(db, memInput({ promotion_target: 'none' }));
        const rows = queryPromotionCandidates(db);
        expect(rows.map(r => r.id)).not.toContain(id);
        db.close();
    });
    it('returns only the valid candidate when mixed with excluded ones', () => {
        const db = freshDb();
        const { id: good } = insertMemory(db, memInput({ body: 'valid candidate body.', promotion_target: 'adr' }));
        const { id: alreadyPromoted } = insertMemory(db, memInput({ body: 'already promoted body.', promotion_target: 'adr' }));
        db.prepare(`UPDATE memories SET promoted_to = 'ADR-001' WHERE id = ?`).run(alreadyPromoted);
        const { id: rejected } = insertMemory(db, memInput({ body: 'rejected body.', promotion_target: 'adr', review_status: 'rejected' }));
        const { id: superseded } = insertMemory(db, memInput({ body: 'superseded body.', promotion_target: 'adr' }));
        const { id: supersedingId } = insertMemory(db, memInput({ body: 'the superseding memory 2.', promotion_target: 'adr' }));
        db.prepare(`UPDATE memories SET superseded_by = ? WHERE id = ?`).run(supersedingId, superseded);
        insertMemory(db, memInput({ body: 'not a candidate body.', promotion_target: 'none' }));
        const rows = queryPromotionCandidates(db);
        const ids = rows.map(r => r.id);
        expect(ids).toContain(good);
        expect(ids).not.toContain(alreadyPromoted);
        expect(ids).not.toContain(rejected);
        expect(ids).not.toContain(superseded);
        db.close();
    });
    it('target filter narrows to one group', () => {
        const db = freshDb();
        const { id: adrId } = insertMemory(db, memInput({ body: 'adr body.', promotion_target: 'adr' }));
        const { id: ddrId } = insertMemory(db, memInput({ body: 'ddr body.', promotion_target: 'ddr' }));
        const adrOnly = queryPromotionCandidates(db, { target: 'adr' });
        expect(adrOnly.map(r => r.id)).toContain(adrId);
        expect(adrOnly.map(r => r.id)).not.toContain(ddrId);
        const ddrOnly = queryPromotionCandidates(db, { target: 'ddr' });
        expect(ddrOnly.map(r => r.id)).toContain(ddrId);
        expect(ddrOnly.map(r => r.id)).not.toContain(adrId);
        db.close();
    });
    it('returns empty result when no candidates exist', () => {
        const db = freshDb();
        // All candidates excluded: none with promotion_target != 'none' eligible
        insertMemory(db, memInput({ promotion_target: 'none' }));
        const rows = queryPromotionCandidates(db);
        expect(rows).toHaveLength(0);
        db.close();
    });
    it('results are ordered by promotion_target then confidence DESC', () => {
        const db = freshDb();
        // Two ADR candidates with different confidences, one DDR
        insertMemory(db, memInput({ body: 'adr low conf.', promotion_target: 'adr', confidence: 0.6 }));
        insertMemory(db, memInput({ body: 'adr high conf.', promotion_target: 'adr', confidence: 0.95 }));
        insertMemory(db, memInput({ body: 'ddr candidate.', promotion_target: 'ddr', confidence: 0.8 }));
        const rows = queryPromotionCandidates(db);
        // adr comes before ddr alphabetically
        const adrRows = rows.filter(r => r.promotion_target === 'adr');
        expect(adrRows[0].confidence).toBeGreaterThan(adrRows[1].confidence);
        const targets = rows.map(r => r.promotion_target);
        expect(targets.indexOf('adr')).toBeLessThan(targets.indexOf('ddr'));
        db.close();
    });
});
// ─────────────────────────────────────────────────────────────────────
// Tests: nexus_mark_promoted
// ─────────────────────────────────────────────────────────────────────
describe('nexus_mark_promoted logic', () => {
    it('rewrites body to first sentence → artifact_ref (AC-3)', async () => {
        const db = freshDb();
        const { id } = insertMemory(db, memInput({
            body: 'Use tabs for indentation. Never use spaces. This is a convention.',
            promotion_target: 'adr',
        }));
        await runMarkPromoted(db, id, 'ADR-063');
        const updated = getMemory(db, id);
        expect(updated.body).toBe('Use tabs for indentation. → ADR-063');
        db.close();
    });
    it('preserves identifiers from the original body even though the pointer body drops them (ADR-20260808214308-a0 regression)', async () => {
        const db = freshDb();
        const { id } = insertMemory(db, memInput({
            body: 'This is unrelated filler that becomes the pointer. The MERGE_COVERAGE_FLOOR in src/core/distill.ts is 0.72.',
            promotion_target: 'adr',
        }));
        await runMarkPromoted(db, id, 'ADR-063');
        const row = db.prepare(`SELECT body, identifiers FROM memories WHERE id = ?`).get(id);
        // The pointer body itself no longer names the identifiers...
        expect(row.body).not.toContain('MERGE_COVERAGE_FLOOR');
        // ...but the identifiers column still carries them forward.
        const ids = JSON.parse(row.identifiers);
        expect(ids).toContain('MERGE_COVERAGE_FLOOR');
        expect(ids).toContain('src/core/distill.ts');
        db.close();
    });
    it('sets promoted_to to the artifact_ref', async () => {
        const db = freshDb();
        const { id } = insertMemory(db, memInput({ body: 'The decision here.', promotion_target: 'adr' }));
        await runMarkPromoted(db, id, 'ADR-063');
        const row = db.prepare(`SELECT promoted_to FROM memories WHERE id = ?`).get(id);
        expect(row.promoted_to).toBe('ADR-063');
        db.close();
    });
    it('does not touch title', async () => {
        const db = freshDb();
        const originalTitle = 'My important decision';
        const { id } = insertMemory(db, memInput({ title: originalTitle, body: 'Decision body.', promotion_target: 'adr' }));
        await runMarkPromoted(db, id, 'ADR-063');
        const updated = getMemory(db, id);
        expect(updated.title).toBe(originalTitle);
        db.close();
    });
    it('does not touch review_status', async () => {
        const db = freshDb();
        const { id } = insertMemory(db, memInput({ body: 'Decision body.', promotion_target: 'adr', review_status: 'approved' }));
        await runMarkPromoted(db, id, 'ADR-063');
        const updated = getMemory(db, id);
        expect(updated.review_status).toBe('approved');
        db.close();
    });
    it('does not append ref again if already present in first sentence', async () => {
        const db = freshDb();
        const body = 'See ADR-063 for context. And more text here.';
        const { id } = insertMemory(db, memInput({ body, promotion_target: 'adr' }));
        await runMarkPromoted(db, id, 'ADR-063');
        const updated = getMemory(db, id);
        // firstSentence includes ADR-063 so no arrow appended
        expect(updated.body).toBe('See ADR-063 for context.');
        db.close();
    });
    it('invokes embed function for the promoted memory (D-005)', async () => {
        const db = freshDb();
        const { id } = insertMemory(db, memInput({ body: 'Embed me.', promotion_target: 'adr' }));
        const embedded = [];
        const trackEmbed = async (memId) => {
            embedded.push(memId);
            return false; // failure is best-effort
        };
        await runMarkPromoted(db, id, 'ADR-063', trackEmbed);
        // Give the .catch promise microtask a tick to settle
        await new Promise(r => setTimeout(r, 0));
        expect(embedded).toContain(id);
        db.close();
    });
    it('still reports success even when embed returns false (D-005)', async () => {
        const db = freshDb();
        const { id } = insertMemory(db, memInput({ body: 'No embed available.', promotion_target: 'adr' }));
        const failEmbed = async (_id) => false;
        const result = await runMarkPromoted(db, id, 'ADR-063', failEmbed);
        expect(result).toMatch(/marked promoted → ADR-063/);
        db.close();
    });
    it('returns error text for unknown id, performs no write', async () => {
        const db = freshDb();
        const { id } = insertMemory(db, memInput({ body: 'Real memory.', promotion_target: 'adr' }));
        const result = await runMarkPromoted(db, 'nonexistent-id', 'ADR-063');
        expect(result).toMatch(/Error: memory not found/);
        // Real memory untouched
        const row = db.prepare(`SELECT promoted_to FROM memories WHERE id = ?`).get(id);
        expect(row.promoted_to).toBeNull();
        db.close();
    });
});
//# sourceMappingURL=server.test.js.map