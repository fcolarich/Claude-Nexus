import { describe, it, expect, vi } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { insertMemory, embedMemory } from './memories.js';
import { recallMemories, recallByQuery } from './recall.js';
import * as embeddings from './embeddings.js';
vi.mock('./embeddings.js', async () => {
    const actual = await vi.importActual('./embeddings.js');
    return { ...actual, generateEmbedding: vi.fn().mockResolvedValue(null) };
});
function freshDb() {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    return db;
}
const base = {
    memory_type: 'convention',
    scope: 'project',
    project: 'projA',
    confidence: 0.8,
    decay_class: 'stable',
    review_status: 'approved',
    source_session_id: null,
    discovered_from: null,
    tags: [],
};
const add = (db, o) => insertMemory(db, { ...base, ...o });
describe('recallMemories', () => {
    it('ranks by score (confidence) descending', () => {
        const db = freshDb();
        add(db, { title: 'Low', body: 'low conf body', confidence: 0.5 });
        add(db, { title: 'High', body: 'high conf body', confidence: 0.95 });
        add(db, { title: 'Mid', body: 'mid conf body', confidence: 0.7 });
        const r = recallMemories(db, { project: 'projA' });
        expect(r.items.map(i => i.memory.title)).toEqual(['High', 'Mid', 'Low']);
        db.close();
    });
    it('degrades to titles-only when the budget is exceeded', () => {
        const db = freshDb();
        const big = 'x'.repeat(400);
        for (let i = 0; i < 6; i++)
            add(db, { title: `Mem ${i}`, body: `${i} ${big}`, confidence: 0.9 - i * 0.05 });
        const r = recallMemories(db, { project: 'projA', maxTokens: 250 });
        expect(r.total).toBe(6);
        expect(r.items.filter(i => i.mode === 'full').length).toBeGreaterThan(0);
        expect(r.items.filter(i => i.mode === 'title').length).toBeGreaterThan(0);
        const firstTitle = r.items.findIndex(i => i.mode === 'title');
        expect(r.items.slice(firstTitle).every(i => i.mode === 'title')).toBe(true);
        db.close();
    });
    it('recalls project + global, excludes other projects', () => {
        const db = freshDb();
        add(db, { title: 'A mem', body: 'belongs to A', project: 'projA' });
        add(db, { title: 'B mem', body: 'belongs to B', project: 'projB' });
        add(db, { title: 'Global mem', body: 'a global one', scope: 'global', project: null });
        const titles = recallMemories(db, { project: 'projA' }).items.map(i => i.memory.title);
        expect(titles).toContain('A mem');
        expect(titles).toContain('Global mem');
        expect(titles).not.toContain('B mem');
        db.close();
    });
    it('pins load_at_init memories first regardless of score', () => {
        const db = freshDb();
        add(db, { title: 'High score', body: 'high one', confidence: 0.95 });
        add(db, { title: 'Pinned', body: 'pinned low conf', confidence: 0.4, load_at_init: true });
        const r = recallMemories(db, { project: 'projA' });
        expect(r.items[0].memory.title).toBe('Pinned');
        db.close();
    });
    it('recalls only approved memories', () => {
        const db = freshDb();
        add(db, { title: 'Approved', body: 'approved body', review_status: 'approved' });
        add(db, { title: 'Pending', body: 'pending body', review_status: 'pending' });
        add(db, { title: 'Rejected', body: 'rejected body', review_status: 'rejected' });
        expect(recallMemories(db, { project: 'projA' }).items.map(i => i.memory.title)).toEqual(['Approved']);
        db.close();
    });
    it('excludes sub-threshold confidence unless load_at_init', () => {
        const db = freshDb();
        add(db, { title: 'TooLow', body: 'too low conf', confidence: 0.2 });
        add(db, { title: 'LowButPinned', body: 'low but pinned', confidence: 0.2, load_at_init: true });
        const titles = recallMemories(db, { project: 'projA' }).items.map(i => i.memory.title);
        expect(titles).not.toContain('TooLow');
        expect(titles).toContain('LowButPinned');
        db.close();
    });
    it('returns empty when there are no memories', () => {
        const db = freshDb();
        const r = recallMemories(db, { project: 'projA' });
        expect(r.items).toHaveLength(0);
        expect(r.markdown).toBe('');
        db.close();
    });
    it('restricts to FTS matches when a query is given', () => {
        const db = freshDb();
        add(db, { title: 'Tabs rule', body: 'always use tabs for indentation' });
        add(db, { title: 'Async rule', body: 'prefer async await over promises' });
        const r = recallMemories(db, { project: 'projA', query: 'tabs' });
        expect(r.items.map(i => i.memory.title)).toEqual(['Tabs rule']);
        db.close();
    });
});
describe('recallByQuery', () => {
    // Offline/CI has no Ollama, so generateEmbedding returns null and recallByQuery
    // uses its FTS5 fallback — these assertions hold on the fallback path.
    it('returns query-matching memories, dual-bank scope', async () => {
        const db = freshDb();
        add(db, { title: 'Tabs rule', body: 'always use tabs for indentation', project: 'projA' });
        add(db, { title: 'Other proj', body: 'tabs but wrong project', project: 'projB' });
        add(db, { title: 'Global tabs', body: 'global tabs note', scope: 'global', project: null });
        const r = await recallByQuery(db, { project: 'projA', query: 'tabs' });
        const titles = r.items.map(i => i.memory.title);
        expect(titles).toContain('Tabs rule');
        expect(titles).toContain('Global tabs');
        expect(titles).not.toContain('Other proj');
        db.close();
    });
    it('excludes memories in excludeIds (session dedup)', async () => {
        const db = freshDb();
        const m = add(db, { title: 'Tabs rule', body: 'always use tabs for indentation' });
        const r = await recallByQuery(db, { project: 'projA', query: 'tabs', excludeIds: [m.id] });
        expect(r.items.map(i => i.memory.title)).not.toContain('Tabs rule');
        db.close();
    });
    it('returns empty for a query that matches nothing', async () => {
        const db = freshDb();
        add(db, { title: 'Tabs rule', body: 'always use tabs for indentation' });
        const r = await recallByQuery(db, { project: 'projA', query: 'kubernetes networking' });
        expect(r.items).toHaveLength(0);
        expect(r.markdown).toBe('');
        db.close();
    });
});
// memories_vec is a fixed-width vec0(embedding float[1024]) table — vectors
// must match that width or the INSERT silently no-ops (embedMemory swallows
// the error). One-hot vectors at distinct indices give deterministic cosine
// similarity: 1.0 for the same index, 0.0 for different indices.
function oneHot(dim) {
    const v = new Float32Array(1024);
    v[dim] = 1;
    return v;
}
describe('recallByQuery reranking', () => {
    // These tests drive the vector-KNN path directly (via embedMemory + a mocked
    // query embedding) so the rerank floor can be exercised without a real
    // Ollama or local-reranker daemon running.
    it('floors on cross-encoder score instead of cosine when reranking succeeds', async () => {
        const db = freshDb();
        const relevant = add(db, { title: 'Relevant', body: 'apple pie recipe' });
        const irrelevant = add(db, { title: 'Irrelevant', body: 'car engine repair' });
        // Both land in the KNN candidate pool regardless of cosine distance —
        // the point of this test is that the rerank floor, not cosine, decides.
        await embedMemory(db, relevant.id, async () => oneHot(0));
        await embedMemory(db, irrelevant.id, async () => oneHot(1));
        vi.mocked(embeddings.generateEmbedding).mockResolvedValueOnce(oneHot(0));
        const fakeRerank = vi.fn(async (_query, documents) => documents
            .map((d, index) => ({ index, score: d.includes('apple') ? 0.9 : 0.05 }))
            .filter(r => r.score >= 0.2)
            .sort((a, b) => b.score - a.score));
        const r = await recallByQuery(db, { project: 'projA', query: 'relevant', rerankFn: fakeRerank });
        expect(fakeRerank).toHaveBeenCalledOnce();
        const titles = r.items.map(i => i.memory.title);
        expect(titles).toContain('Relevant');
        expect(titles).not.toContain('Irrelevant');
        db.close();
    });
    it('falls back to the cosine floor when reranking is unavailable', async () => {
        const db = freshDb();
        const close = add(db, { title: 'Close', body: 'close content' });
        const far = add(db, { title: 'Far', body: 'far content' });
        await embedMemory(db, close.id, async () => oneHot(0));
        await embedMemory(db, far.id, async () => oneHot(1)); // orthogonal -> cosine sim 0
        vi.mocked(embeddings.generateEmbedding).mockResolvedValueOnce(oneHot(0));
        const failingRerank = vi.fn(async () => null);
        const r = await recallByQuery(db, {
            project: 'projA', query: 'close', rerankFn: failingRerank, minSimilarity: 0.5,
        });
        expect(failingRerank).toHaveBeenCalledOnce();
        const titles = r.items.map(i => i.memory.title);
        expect(titles).toContain('Close');
        expect(titles).not.toContain('Far');
        db.close();
    });
});
//# sourceMappingURL=recall.test.js.map