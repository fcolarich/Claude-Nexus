import { vi, describe, it, expect, beforeEach } from 'vitest';
// We reset modules between cases so the module-level `cached` var is cleared
// and vi.doMock can inject a fresh fs stub before each dynamic import.
describe('getNexusConfig — reranker.enabled default (SC-6)', () => {
    beforeEach(() => {
        vi.resetModules();
    });
    it('Case A: reranker.enabled === true when yaml omits the reranker key', async () => {
        // Simulate a yaml that has only embedding config — no reranker section.
        // loaded.reranker is undefined, so the merge falls back entirely to DEFAULTS.reranker.
        vi.doMock('fs', () => ({
            existsSync: vi.fn().mockReturnValue(true),
            readFileSync: vi.fn().mockReturnValue('embedding:\n  model: test-model\n'),
        }));
        const { getNexusConfig } = await import('./config.js');
        expect(getNexusConfig().reranker.enabled).toBe(true);
    });
    it('Case B: explicit reranker.enabled: false in yaml overrides the true default', async () => {
        // Simulate a yaml that explicitly opts out of the reranker.
        // The spread { ...DEFAULTS.reranker, ...loaded.reranker } must let this win.
        vi.doMock('fs', () => ({
            existsSync: vi.fn().mockReturnValue(true),
            readFileSync: vi.fn().mockReturnValue('reranker:\n  enabled: false\n'),
        }));
        const { getNexusConfig } = await import('./config.js');
        expect(getNexusConfig().reranker.enabled).toBe(false);
    });
});
//# sourceMappingURL=config.test.js.map