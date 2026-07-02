import { describe, it, expect, vi, afterEach } from 'vitest';
import { rerank } from './reranker.js';
// rerank() calls ensureRerankerRunning() first, which does a health-check fetch
// before the real POST. Never let that health check fail in these tests — a
// failure triggers a real `spawn('python', ...)` + 30s poll loop, which would
// launch a real subprocess and stall the suite. Mock spawn as a hard backstop
// regardless, and always answer the health check ok so it short-circuits.
vi.mock('child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));
describe('rerank', () => {
    const originalFetch = global.fetch;
    const healthOk = { ok: true };
    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });
    it('returns mapped results on a successful response', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce(healthOk)
            .mockResolvedValueOnce({
            ok: true,
            json: async () => [
                { index: 1, document: 'b', score: 0.9 },
                { index: 0, document: 'a', score: 0.3 },
            ],
        });
        const result = await rerank('query', ['a', 'b']);
        expect(result).toEqual([{ index: 1, score: 0.9 }, { index: 0, score: 0.3 }]);
    });
    it('returns null on a non-ok HTTP response', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce(healthOk)
            .mockResolvedValueOnce({ ok: false, status: 500 });
        const result = await rerank('query', ['a', 'b']);
        expect(result).toBeNull();
    });
    it('returns null when the rerank request fails', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce(healthOk)
            .mockRejectedValueOnce(new Error('ECONNREFUSED'));
        const result = await rerank('query', ['a', 'b']);
        expect(result).toBeNull();
    });
    it('returns null when the request times out', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce(healthOk)
            .mockRejectedValueOnce(new DOMException('The operation was aborted', 'TimeoutError'));
        const result = await rerank('query', ['a', 'b']);
        expect(result).toBeNull();
    });
    it('returns null for an empty documents list without calling fetch', async () => {
        global.fetch = vi.fn();
        const result = await rerank('query', []);
        expect(result).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=reranker.test.js.map