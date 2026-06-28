import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readDecisionIndex } from './docspine.js';
let root;
beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'nexus-docspine-'));
    const dir = join(root, '_documents', 'decisions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'adr-001-upm-package-per-tool.md'), '---\ntitle: foo\n---\n\n# UPM package-per-tool baseline\n\nbody');
    writeFileSync(join(dir, 'ddr-001-naming.md'), '# Naming convention\n\nbody');
    writeFileSync(join(dir, 'README.md'), '# not a decision');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
describe('readDecisionIndex', () => {
    it('lists adr/ddr titles with ids', () => {
        const out = readDecisionIndex(root);
        expect(out).toContain('ADR-001: UPM package-per-tool baseline');
        expect(out).toContain('DDR-001: Naming convention');
        expect(out.some(l => l.includes('README'))).toBe(false);
    });
    it('returns [] for a missing spine', () => {
        expect(readDecisionIndex(join(root, 'nope'))).toEqual([]);
    });
    it('returns [] for undefined cwd', () => {
        expect(readDecisionIndex(undefined)).toEqual([]);
    });
});
//# sourceMappingURL=docspine.test.js.map