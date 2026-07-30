import { describe, it, expect, vi } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { insertMemory, embedMemory } from './memories.js';
import { recallMemories, recallByQuery, estTokensForTest } from './recall.js';
import * as embeddings from './embeddings.js';
import * as gptTokenizer from 'gpt-tokenizer';
vi.mock('./embeddings.js', async () => {
    const actual = await vi.importActual('./embeddings.js');
    return { ...actual, generateEmbedding: vi.fn().mockResolvedValue(null) };
});
// This dev machine happens to run a real local-reranker HTTP daemon (see
// extraction_models.yaml, reranker.enabled: true), and DEFAULTS.reranker.enabled
// is now also true (task-012). Without this mock, every recallByQuery() call in
// this file that doesn't pass an explicit `rerankFn` would hit that real network
// service — nondeterministic on machines without the daemon, and a source of
// cross-suite latency contention when the full Vitest suite runs many files in
// parallel (surfaced as an unrelated backfill.test.ts timeout during the task-013
// integration gate). Default to "unavailable" (null), matching the reranker's own
// documented contract for disabled/unreachable. Tests that need real reranking
// behavior inject their own `rerankFn` via recallByQuery's opts, which bypasses
// this module mock entirely (`doRerank = opts.rerankFn ?? rerankDocuments`).
vi.mock('./reranker.js', () => ({ rerank: vi.fn().mockResolvedValue(null) }));
// Wrap real encode in a vi.fn so we can override it in the fallback test.
// All other tests use the real implementation transparently.
vi.mock('gpt-tokenizer', async () => {
    const actual = await vi.importActual('gpt-tokenizer');
    return { ...actual, encode: vi.fn((s) => actual.encode(s)) };
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
    promotion_target: 'none',
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
describe('estTokens', () => {
    // Fixtures chosen because the chars/4 heuristic is meaningfully inaccurate for
    // both: code tokens are dense (many chars per token), prose is close but not exact.
    const codeSnippet = 'function add(a, b) { return a + b; }\n';
    const prose = 'The quick brown fox jumps over the lazy dog.';
    it('empty string → 0', () => {
        expect(estTokensForTest('')).toBe(0);
    });
    it('code-snippet: BPE estimate equals actual; heuristic is strictly less accurate', () => {
        // BPE is exact by definition (encode().length IS the true token count).
        // chars/4 rounds up so it differs from actual for this code string.
        const actual = gptTokenizer.encode(codeSnippet).length;
        const bpe = estTokensForTest(codeSnippet);
        const heuristicErr = Math.abs(Math.ceil(codeSnippet.length / 4) - actual);
        expect(bpe).toBe(actual);
        // Heuristic must deviate (if it were equal, BPE would provide zero added value).
        expect(heuristicErr).toBeGreaterThan(0);
    });
    it('prose: BPE estimate equals actual cl100k_base count', () => {
        // actual is derived from the same encoder — BPE must return the exact count.
        // Old chars/4 heuristic returns Math.ceil(44/4)=11 for this string but actual is 10.
        const actual = gptTokenizer.encode(prose).length;
        const bpe = estTokensForTest(prose);
        expect(bpe).toBe(actual);
    });
    it('fallback: returns ceil(len/4) when encode throws; does not propagate', () => {
        // Unique string guarantees no memo hit so encode is actually attempted.
        const s = 'fallback_unique_' + Math.random().toString(36);
        vi.mocked(gptTokenizer.encode).mockClear();
        vi.mocked(gptTokenizer.encode).mockImplementationOnce(() => { throw new Error('encode error'); });
        const expected = Math.ceil(s.length / 4);
        expect(estTokensForTest(s)).toBe(expected);
        // encode was attempted (try branch) but fell back gracefully without propagating.
        expect(vi.mocked(gptTokenizer.encode)).toHaveBeenCalledWith(s);
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
describe('recallByQuery RRF fusion (SC-5)', () => {
    // All tests mock generateEmbedding to return non-null so the vector path runs
    // alongside FTS5, enabling real fusion behaviour to be exercised.
    it('SC-5: FTS5-exact hit that vector-only would suppress appears in fused top-N', async () => {
        // Pre-fusion (old) behaviour: ftsHit has cosine sim ≈ 0 → dropped by floor.
        // Post-fusion (new) behaviour: ftsHit is in ftsSet → floor bypassed → appears.
        const db = freshDb();
        const ftsHit = add(db, { title: 'FTS Hit', body: 'alphakeyword unique term here' });
        const vecDominant = add(db, { title: 'Vec Dominant', body: 'completely unrelated content' });
        await embedMemory(db, ftsHit.id, async () => oneHot(50)); // orthogonal → sim ≈ 0
        await embedMemory(db, vecDominant.id, async () => oneHot(0)); // aligned → sim = 1.0
        vi.mocked(embeddings.generateEmbedding).mockResolvedValueOnce(oneHot(0));
        const r = await recallByQuery(db, {
            project: 'projA',
            query: 'alphakeyword',
            minSimilarity: 0.5, // ftsHit sim=0 < floor; but ftsSet bypass keeps it alive
            // Force the fallback path so this test exercises fusion/floor logic in
            // isolation, independent of whatever local reranker daemon extraction_models.yaml
            // points at (reranker.enabled: true there) — that interaction is covered
            // separately by the two reranker-focused SC-5 tests below.
            rerankFn: async () => null,
        });
        const titles = r.items.map(i => i.memory.title);
        expect(titles).toContain('FTS Hit'); // SC-5: must survive despite low cosine sim
        expect(titles).toContain('Vec Dominant'); // strong vector match still present
        db.close();
    });
    it('minSimilarity floor bypasses FTS5-matched ids and drops vec-only below floor', async () => {
        const db = freshDb();
        const ftsHit = add(db, { title: 'FTS Hit', body: 'betakeyword exact match' });
        const vecAboveFloor = add(db, { title: 'Vec Above', body: 'no keyword high sim' });
        const vecBelowFloor = add(db, { title: 'Vec Below', body: 'no keyword low sim' });
        await embedMemory(db, ftsHit.id, async () => oneHot(60)); // sim=0 (below floor)
        await embedMemory(db, vecAboveFloor.id, async () => oneHot(0)); // sim=1.0 (above floor)
        await embedMemory(db, vecBelowFloor.id, async () => oneHot(70)); // sim=0 (below floor)
        vi.mocked(embeddings.generateEmbedding).mockResolvedValueOnce(oneHot(0));
        const r = await recallByQuery(db, {
            project: 'projA',
            query: 'betakeyword',
            minSimilarity: 0.5,
            rerankFn: async () => null, // isolate floor logic from the live reranker daemon
        });
        const titles = r.items.map(i => i.memory.title);
        expect(titles).toContain('FTS Hit'); // ftsSet bypass: survives despite sim=0
        expect(titles).toContain('Vec Above'); // sim=1.0 passes floor
        expect(titles).not.toContain('Vec Below'); // vec-only, sim=0 < floor → correctly dropped
        db.close();
    });
    it('drops excludeIds from fused result even when the memory ranks highly', async () => {
        const db = freshDb();
        // excluded has keyword in body AND high cosine sim → top of both FTS5 and vector lists
        const excluded = add(db, { title: 'Excluded', body: 'gammakeyword highly relevant' });
        // kept has keyword only (vec sim=0 → in ftsSet, bypasses floor)
        const kept = add(db, { title: 'Kept', body: 'gammakeyword also here' });
        await embedMemory(db, excluded.id, async () => oneHot(0)); // sim=1.0
        await embedMemory(db, kept.id, async () => oneHot(80)); // sim=0
        vi.mocked(embeddings.generateEmbedding).mockResolvedValueOnce(oneHot(0));
        const r = await recallByQuery(db, {
            project: 'projA',
            query: 'gammakeyword',
            excludeIds: [excluded.id],
            minSimilarity: 0.5,
            rerankFn: async () => null, // isolate excludeIds logic from the live reranker daemon
        });
        const titles = r.items.map(i => i.memory.title);
        expect(titles).not.toContain('Excluded'); // excluded even though it would rank highest
        expect(titles).toContain('Kept'); // kept is in ftsSet → floor bypassed
        db.close();
    });
    it('reranker receives the fused set including FTS5-only memories', async () => {
        const db = freshDb();
        // ftsOnly: keyword match, low sim → in ftsSet → must reach reranker despite low cosine
        const ftsOnly = add(db, { title: 'FTS Only', body: 'deltakeyword fts only memory' });
        // vecOnly: no keyword, high sim → passes floor → also reaches reranker
        const vecOnly = add(db, { title: 'Vec Only', body: 'no keyword high similarity' });
        await embedMemory(db, ftsOnly.id, async () => oneHot(90)); // sim=0
        await embedMemory(db, vecOnly.id, async () => oneHot(0)); // sim=1.0
        vi.mocked(embeddings.generateEmbedding).mockResolvedValueOnce(oneHot(0));
        const capturedDocs = [];
        const spyRerank = vi.fn(async (_q, documents) => {
            capturedDocs.push(...documents);
            return documents.map((_, index) => ({ index, score: 0.8 }));
        });
        await recallByQuery(db, {
            project: 'projA',
            query: 'deltakeyword',
            rerankFn: spyRerank,
            minSimilarity: 0.5,
        });
        expect(spyRerank).toHaveBeenCalledOnce();
        // Reranker must see both: FTS5-only memory (sim=0, ftsSet bypass) and vec-only (sim=1)
        expect(capturedDocs).toContain('deltakeyword fts only memory');
        expect(capturedDocs).toContain('no keyword high similarity');
        db.close();
    });
    it('reranker throw falls back to fused order without crashing', async () => {
        const db = freshDb();
        const m = add(db, { title: 'Some Memory', body: 'epsilonkeyword content here' });
        await embedMemory(db, m.id, async () => oneHot(0)); // sim=1.0
        vi.mocked(embeddings.generateEmbedding).mockResolvedValueOnce(oneHot(0));
        const throwingRerank = vi.fn(async () => { throw new Error('reranker service down'); });
        // Must not throw — falls back to fused order
        const r = await recallByQuery(db, {
            project: 'projA',
            query: 'epsilonkeyword',
            rerankFn: throwingRerank,
        });
        expect(throwingRerank).toHaveBeenCalledOnce();
        expect(r.items.map(i => i.memory.title)).toContain('Some Memory');
        db.close();
    });
});
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