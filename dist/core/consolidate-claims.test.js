import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { insertMemory } from './memories.js';
import { insertClaim, getClaim, embedClaim } from './claims.js';
import { consolidateClaims } from './consolidate-claims.js';
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
/** Unit vector at angle theta in the (0,1) plane — cosine between unit(0) and unit(theta) is cos(theta). */
function unitAt(theta) {
    const v = new Float32Array(1024);
    v[0] = Math.cos(theta);
    v[1] = Math.sin(theta);
    return v;
}
const vecIdentical = unitAt(0);
// cos(theta) ≈ 0.93 lands combinedSimilarity in the flag band (0.92-0.98) when fuzzy=1.0:
// combined = 0.93*0.7 + 1.0*0.3 = 0.951.
const vecFlagBand = unitAt(Math.acos(0.93));
// cos(theta) ≈ 0.5 keeps combined well below the flag floor even with fuzzy=1.0:
// combined = 0.5*0.7 + 1.0*0.3 = 0.65.
const vecUnrelated = unitAt(Math.acos(0.5));
const noopEmbed = async (_text) => null; // never used when every claim is pre-embedded
describe('consolidateClaims', () => {
    it('auto-merge band invalidates the lower-confidence claim and writes a supersedes edge from the survivor', async () => {
        const db = freshDb();
        const m1 = insertMemory(db, { ...baseMem, title: 'M1', body: 'body one', confidence: 0.9 });
        const m2 = insertMemory(db, { ...baseMem, title: 'M2', body: 'body two', confidence: 0.6 });
        // Case-different but content-identical -> fuzzyStringSimilarity normalizes to 1.0,
        // distinct content-addressed ids (case-sensitive) so both rows actually exist.
        const { id: strong } = insertClaim(db, { memory_id: m1.id, source_memory_id: m1.id, fact: 'the coverage floor is 0.72', claim_type: 'decision', confidence: 0.9 });
        const { id: weak } = insertClaim(db, { memory_id: m2.id, source_memory_id: m2.id, fact: 'The Coverage Floor Is 0.72', claim_type: 'decision', confidence: 0.6 });
        await embedClaim(db, strong, async () => vecIdentical);
        await embedClaim(db, weak, async () => vecIdentical);
        const r = await consolidateClaims(db, undefined, noopEmbed);
        expect(r.autoMerged).toBe(1);
        expect(getClaim(db, strong).valid_until).toBeNull();
        expect(getClaim(db, weak).valid_until).not.toBeNull();
        const edge = db.prepare(`SELECT * FROM memory_links WHERE source_id = ? AND target_id = ? AND link_type = 'supersedes'`).get(strong, weak);
        expect(edge).toBeDefined();
        db.close();
    });
    it('flag band writes bidirectional same_as edges, neither claim invalidated', async () => {
        const db = freshDb();
        const m1 = insertMemory(db, { ...baseMem, title: 'M1', body: 'body one' });
        const m2 = insertMemory(db, { ...baseMem, title: 'M2', body: 'body two' });
        const { id: a } = insertClaim(db, { memory_id: m1.id, source_memory_id: m1.id, fact: 'the threshold claim', claim_type: 'decision', confidence: 0.7 });
        const { id: b } = insertClaim(db, { memory_id: m2.id, source_memory_id: m2.id, fact: 'The Threshold Claim', claim_type: 'decision', confidence: 0.7 });
        await embedClaim(db, a, async () => vecIdentical);
        await embedClaim(db, b, async () => vecFlagBand);
        const r = await consolidateClaims(db, undefined, noopEmbed);
        expect(r.flagged).toBeGreaterThanOrEqual(1);
        expect(r.autoMerged).toBe(0);
        expect(getClaim(db, a).valid_until).toBeNull();
        expect(getClaim(db, b).valid_until).toBeNull();
        const ab = db.prepare(`SELECT * FROM memory_links WHERE source_id = ? AND target_id = ? AND link_type = 'same_as'`).get(a, b);
        const ba = db.prepare(`SELECT * FROM memory_links WHERE source_id = ? AND target_id = ? AND link_type = 'same_as'`).get(b, a);
        expect(ab).toBeDefined();
        expect(ba).toBeDefined();
        db.close();
    });
    it('a numeric contradiction vetoes similarity treatment entirely — writes contradicts, never invalidates or same_as', async () => {
        const db = freshDb();
        const m1 = insertMemory(db, { ...baseMem, title: 'M1', body: 'body one', confidence: 0.9 });
        const m2 = insertMemory(db, { ...baseMem, title: 'M2', body: 'body two', confidence: 0.6 });
        // Near-identical embeddings (would otherwise auto-merge), but different numeric value.
        const { id: a } = insertClaim(db, { memory_id: m1.id, source_memory_id: m1.id, fact: 'MERGE_COVERAGE_FLOOR is 0.72', claim_type: 'decision', confidence: 0.9 });
        const { id: b } = insertClaim(db, { memory_id: m2.id, source_memory_id: m2.id, fact: 'MERGE_COVERAGE_FLOOR is 0.75', claim_type: 'decision', confidence: 0.6 });
        await embedClaim(db, a, async () => vecIdentical);
        await embedClaim(db, b, async () => vecIdentical);
        const r = await consolidateClaims(db, undefined, noopEmbed);
        expect(r.contradictions).toBeGreaterThanOrEqual(1);
        expect(r.autoMerged).toBe(0);
        expect(r.flagged).toBe(0);
        expect(getClaim(db, a).valid_until).toBeNull();
        expect(getClaim(db, b).valid_until).toBeNull();
        const contra = db.prepare(`SELECT * FROM memory_links WHERE source_id = ? AND target_id = ? AND link_type = 'contradicts'`).get(a, b);
        expect(contra).toBeDefined();
        db.close();
    });
    it('low-similarity claims (new band) get no edges at all', async () => {
        const db = freshDb();
        const m1 = insertMemory(db, { ...baseMem, title: 'M1', body: 'body one' });
        const m2 = insertMemory(db, { ...baseMem, title: 'M2', body: 'body two' });
        const { id: a } = insertClaim(db, { memory_id: m1.id, source_memory_id: m1.id, fact: 'a completely unrelated fact', claim_type: 'decision', confidence: 0.7 });
        const { id: b } = insertClaim(db, { memory_id: m2.id, source_memory_id: m2.id, fact: 'zebras migrate seasonally', claim_type: 'decision', confidence: 0.7 });
        await embedClaim(db, a, async () => vecIdentical);
        await embedClaim(db, b, async () => vecUnrelated);
        const r = await consolidateClaims(db, undefined, noopEmbed);
        expect(r.autoMerged).toBe(0);
        expect(r.flagged).toBe(0);
        expect(r.contradictions).toBe(0);
        const links = db.prepare(`SELECT COUNT(*) c FROM memory_links`).get();
        expect(links.c).toBe(0);
        db.close();
    });
    it('embeds any claim lacking a vector before scoring', async () => {
        const db = freshDb();
        const m1 = insertMemory(db, { ...baseMem, title: 'M1', body: 'body one' });
        insertClaim(db, { memory_id: m1.id, source_memory_id: m1.id, fact: 'a claim needing an embedding', claim_type: 'decision', confidence: 0.7 });
        const r = await consolidateClaims(db, undefined, async () => vecIdentical);
        expect(r.embedded).toBe(1);
        db.close();
    });
    it('scopes to a single project when opts.project is given', async () => {
        const db = freshDb();
        const mA = insertMemory(db, { ...baseMem, title: 'MA', body: 'body a', project: 'proj-a', confidence: 0.9 });
        const mB = insertMemory(db, { ...baseMem, title: 'MB', body: 'body b', project: 'proj-a', confidence: 0.6 });
        const mC = insertMemory(db, { ...baseMem, title: 'MC', body: 'body c', project: 'proj-b', confidence: 0.9 });
        const mD = insertMemory(db, { ...baseMem, title: 'MD', body: 'body d', project: 'proj-b', confidence: 0.6 });
        const { id: a } = insertClaim(db, { memory_id: mA.id, source_memory_id: mA.id, fact: 'proj-a shared fact', claim_type: 'decision', confidence: 0.9 });
        const { id: b } = insertClaim(db, { memory_id: mB.id, source_memory_id: mB.id, fact: 'Proj-A Shared Fact', claim_type: 'decision', confidence: 0.6 });
        const { id: c } = insertClaim(db, { memory_id: mC.id, source_memory_id: mC.id, fact: 'proj-b shared fact', claim_type: 'decision', confidence: 0.9 });
        const { id: d } = insertClaim(db, { memory_id: mD.id, source_memory_id: mD.id, fact: 'Proj-B Shared Fact', claim_type: 'decision', confidence: 0.6 });
        await embedClaim(db, a, async () => vecIdentical);
        await embedClaim(db, b, async () => vecIdentical);
        await embedClaim(db, c, async () => vecIdentical);
        await embedClaim(db, d, async () => vecIdentical);
        const r = await consolidateClaims(db, { project: 'proj-a' }, noopEmbed);
        expect(r.processed).toBe(2); // only proj-a's two claims
        expect(r.autoMerged).toBe(1); // proj-a pair merges; proj-b pair untouched
        db.close();
    });
});
//# sourceMappingURL=consolidate-claims.test.js.map