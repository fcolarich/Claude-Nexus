import { describe, it, expect } from 'vitest';
import { judgeMemoryUsefulness } from './feedback-judge.js';
const MEMORIES = [
    { id: 'mem-1', title: 'Use RRF for hybrid search', body: 'Fuse FTS5 and vector rank with RRF_K=60.' },
    { id: 'mem-2', title: 'Unrelated fact about Docker', body: 'Docker Desktop crashes on AF_UNIX sockets.' },
];
describe('judgeMemoryUsefulness', () => {
    it('returns verdicts for well-formed JSON output', async () => {
        const haikuFn = async () => JSON.stringify([
            { id: 'mem-1', helped: true },
            { id: 'mem-2', helped: false },
        ]);
        const result = await judgeMemoryUsefulness('transcript text here', MEMORIES, haikuFn);
        expect(result).toEqual([
            { id: 'mem-1', helped: true },
            { id: 'mem-2', helped: false },
        ]);
    });
    it('returns an empty array for malformed JSON', async () => {
        const haikuFn = async () => 'not json at all';
        const result = await judgeMemoryUsefulness('transcript text', MEMORIES, haikuFn);
        expect(result).toEqual([]);
    });
    it('returns an empty array when the response is valid JSON but not an array', async () => {
        const haikuFn = async () => JSON.stringify({ id: 'mem-1', helped: true });
        const result = await judgeMemoryUsefulness('transcript text', MEMORIES, haikuFn);
        expect(result).toEqual([]);
    });
    it('drops entries with an unknown id or non-boolean helped, keeps valid ones', async () => {
        const haikuFn = async () => JSON.stringify([
            { id: 'mem-1', helped: true },
            { id: 'mem-unknown', helped: true },
            { id: 'mem-2', helped: 'yes' },
        ]);
        const result = await judgeMemoryUsefulness('transcript text', MEMORIES, haikuFn);
        expect(result).toEqual([{ id: 'mem-1', helped: true }]);
    });
    it('returns an empty array immediately for an empty memory list, without calling haikuFn', async () => {
        let called = false;
        const haikuFn = async () => { called = true; return '[]'; };
        const result = await judgeMemoryUsefulness('transcript text', [], haikuFn);
        expect(result).toEqual([]);
        expect(called).toBe(false);
    });
    it('returns an empty array if haikuFn throws', async () => {
        const haikuFn = async () => { throw new Error('network error'); };
        const result = await judgeMemoryUsefulness('transcript text', MEMORIES, haikuFn);
        expect(result).toEqual([]);
    });
});
//# sourceMappingURL=feedback-judge.test.js.map