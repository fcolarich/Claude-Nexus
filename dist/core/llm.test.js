import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Hoisted so the vi.mock factories below can close over them — vi.mock is lifted
// above the imports, which would otherwise read these before initialization.
const h = vi.hoisted(() => ({
    cfg: {
        provider: 'claude-agent-sdk',
        endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
        model: 'test-model',
        timeout_ms: 150,
        temperature: 0.2,
    },
    query: vi.fn(),
}));
vi.mock('./config.js', () => ({ getNexusConfig: () => ({ extraction: h.cfg }) }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: h.query }));
import { callModel } from './llm.js';
/** An SDK stream that yields nothing and never settles — the wedged `claude` CLI. */
const hangForever = () => ({
    async *[Symbol.asyncIterator]() {
        await new Promise(() => { });
    },
});
const yieldResult = (text) => ({
    async *[Symbol.asyncIterator]() {
        yield { type: 'result', subtype: 'success', result: text };
    },
});
describe('callModel — agent-sdk provider', () => {
    beforeEach(() => {
        h.query.mockReset();
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });
    afterEach(() => vi.restoreAllMocks());
    it('returns the result text on a normal response', async () => {
        h.query.mockReturnValue(yieldResult('merged body'));
        expect(await callModel('sys', 'user')).toBe('merged body');
    });
    // The 2026-08-02 regression: abortController fired at 120s and the call still
    // ran 1800s, because aborting a stream that never yields does not end the
    // `for await`. Without the hard timer this test hangs until vitest kills it.
    it('gives up on schedule when the SDK stream never settles', async () => {
        h.query.mockReturnValue(hangForever());
        const t0 = Date.now();
        const out = await callModel('sys', 'user');
        const elapsed = Date.now() - t0;
        expect(out).toBe(''); // degrades, never throws at the caller
        expect(elapsed).toBeLessThan(2000); // budget is 150ms; generous for slow CI
    });
    it('still signals the abort controller so a responsive SDK can clean up', async () => {
        h.query.mockReturnValue(hangForever());
        await callModel('sys', 'user');
        const opts = h.query.mock.calls[0][0].options;
        expect(opts.abortController.signal.aborted).toBe(true);
    });
});
//# sourceMappingURL=llm.test.js.map