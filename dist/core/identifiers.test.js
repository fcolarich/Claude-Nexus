import { describe, it, expect } from 'vitest';
import { extractIdentifiers, unionIdentifiers } from './identifiers.js';
describe('extractIdentifiers', () => {
    it('extracts backticked spans', () => {
        expect(extractIdentifiers('Run `npm run build` first')).toContain('npm run build');
    });
    it('extracts file paths without backticks', () => {
        const ids = extractIdentifiers('Edit src/core/distill.ts to fix the bug');
        expect(ids).toContain('src/core/distill.ts');
    });
    it('extracts an underscore-joined path segment even without backticks', () => {
        // Matches scripts/audit-merges.mjs's own --strict pattern set exactly (by
        // design — see the module docstring). A purely hyphen-joined plain-English
        // segment like "unity-workflow-optimization" is deliberately filtered as
        // reworadable prose (the same "plain hyphenated English" rule that keeps
        // "self-contained" out); a mixed-case/underscore segment like
        // "Fran_Unity" is not plain English and is captured. This is a known,
        // inherited extraction gap (not every path segment survives), not
        // silently widened here — Phase 1's validation gate is what surfaces
        // gaps like this rather than papering over them.
        const ids = extractIdentifiers('Located at C:\\Fran_Unity\\unity-workflow-optimization');
        expect(ids).toContain('Fran_Unity');
    });
    it('extracts config keys (CONST_NAMES)', () => {
        const ids = extractIdentifiers('Set MERGE_COVERAGE_FLOOR before running');
        expect(ids).toContain('MERGE_COVERAGE_FLOOR');
    });
    it('extracts CamelCase identifiers', () => {
        expect(extractIdentifiers('Calls DistillMemories internally')).toContain('DistillMemories');
    });
    it('extracts decimals and multi-digit numbers', () => {
        const ids = extractIdentifiers('Threshold is 0.72 across 651 merges');
        expect(ids).toContain('0.72');
        expect(ids).toContain('651');
    });
    it('extracts cross-reference IDs', () => {
        const ids = extractIdentifiers('See ADR-019 and RCP-vfx-004 for details');
        expect(ids).toContain('ADR-019');
        expect(ids).toContain('RCP-vfx-004');
    });
    it('ignores plain hyphenated English prose', () => {
        const ids = extractIdentifiers('This is a self-contained, end-to-end description');
        expect(ids).not.toContain('self-contained');
        expect(ids).not.toContain('end-to-end');
    });
    it('ignores ALLCAPS emphasis words', () => {
        const ids = extractIdentifiers('Do NOT skip this. Reproduce ALL identifiers ONLY here.');
        expect(ids).not.toContain('NOT');
        expect(ids).not.toContain('ALL');
        expect(ids).not.toContain('ONLY');
    });
    it('ignores e.g./i.e./etc noise', () => {
        const ids = extractIdentifiers('Use a tool, e.g. npm, etc.');
        expect(ids).not.toContain('e.g');
        expect(ids).not.toContain('etc');
    });
    it('strips backticks and wrapping punctuation from tokens', () => {
        const ids = extractIdentifiers('The file `config.yaml` (see "settings.json") matters');
        expect(ids).toContain('config.yaml');
        expect(ids).toContain('settings.json');
    });
    it('de-duplicates repeated identifiers', () => {
        const ids = extractIdentifiers('src/core/distill.ts and src/core/distill.ts again');
        expect(ids.filter(id => id === 'src/core/distill.ts')).toHaveLength(1);
    });
    it('returns empty array for empty or non-identifier text', () => {
        expect(extractIdentifiers('')).toEqual([]);
        expect(extractIdentifiers('This is just plain English prose with no code.')).toEqual([]);
    });
    it('is deterministic — same input, same output, every call', () => {
        const text = 'Reference src/core/distill.ts, ADR-018, and MERGE_COVERAGE_FLOOR at 0.72';
        const a = extractIdentifiers(text);
        const b = extractIdentifiers(text);
        expect(a).toEqual(b);
    });
});
describe('unionIdentifiers', () => {
    it('unions multiple lists, de-duplicated', () => {
        const result = unionIdentifiers(['a', 'b'], ['b', 'c'], ['c', 'd']);
        expect(result.sort()).toEqual(['a', 'b', 'c', 'd']);
    });
    it('preserves case-sensitive distinctness', () => {
        const result = unionIdentifiers(['ADR-019'], ['adr-019']);
        expect(result).toContain('ADR-019');
        expect(result).toContain('adr-019');
        expect(result).toHaveLength(2);
    });
    it('handles empty lists', () => {
        expect(unionIdentifiers([], [])).toEqual([]);
        expect(unionIdentifiers()).toEqual([]);
    });
    it('is the only place identifiers combine across sources — set-union, not extraction from merged prose', () => {
        // Simulates a merge whose prose dropped an identifier the model saw but
        // didn't reproduce: union still carries it forward from the sources.
        const sourceA = extractIdentifiers('Uses src/core/distill.ts and MERGE_COVERAGE_FLOOR');
        const sourceB = extractIdentifiers('Also touches src/core/memories.ts');
        const droppedByModel = extractIdentifiers('A prose summary that mentions neither file');
        const merged = unionIdentifiers(sourceA, sourceB, droppedByModel);
        expect(merged).toContain('src/core/distill.ts');
        expect(merged).toContain('src/core/memories.ts');
        expect(merged).toContain('MERGE_COVERAGE_FLOOR');
    });
});
//# sourceMappingURL=identifiers.test.js.map