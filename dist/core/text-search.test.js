import { describe, it, expect } from 'vitest';
import { grepText } from './text-search.js';
describe('grepText', () => {
    it('returns zero matches when the query does not appear', () => {
        const result = grepText('line one\nline two\nline three', 'zzz');
        expect(result).toEqual({ matches: [], totalMatches: 0, truncated: false });
    });
    it('finds a single match with default context lines around it', () => {
        const text = 'alpha\nbeta needle\ngamma';
        const result = grepText(text, 'needle');
        expect(result.totalMatches).toBe(1);
        expect(result.truncated).toBe(false);
        expect(result.matches).toHaveLength(1);
        expect(result.matches[0]).toEqual({
            line: 2,
            occurrences: 1,
            snippet: 'alpha\nbeta needle\ngamma',
        });
    });
    it('collapses multiple hits on the same line into one match with an occurrences count', () => {
        const text = 'needle needle needle';
        const result = grepText(text, 'needle');
        expect(result.totalMatches).toBe(1);
        expect(result.matches).toHaveLength(1);
        expect(result.matches[0].occurrences).toBe(3);
    });
    it('caps matches at maxMatches and sets truncated true, while totalMatches reflects the true count', () => {
        const lines = Array.from({ length: 5 }, (_, i) => `needle ${i}`);
        const result = grepText(lines.join('\n'), 'needle', { maxMatches: 2 });
        expect(result.totalMatches).toBe(5);
        expect(result.matches).toHaveLength(2);
        expect(result.truncated).toBe(true);
    });
    it('does not read out of bounds when the match is on the first line', () => {
        const text = 'needle here\nsecond line\nthird line';
        const result = grepText(text, 'needle');
        expect(result.matches[0]).toEqual({
            line: 1,
            occurrences: 1,
            snippet: 'needle here\nsecond line',
        });
    });
    it('does not read out of bounds when the match is on the last line', () => {
        const text = 'first line\nsecond line\nneedle here';
        const result = grepText(text, 'needle');
        expect(result.matches[0]).toEqual({
            line: 3,
            occurrences: 1,
            snippet: 'second line\nneedle here',
        });
    });
    it('trims a long line centered on the first hit, bounded by maxSnippetChars', () => {
        const padding = 'x'.repeat(300);
        const text = `${padding}needle${padding}`;
        const result = grepText(text, 'needle', { maxSnippetChars: 40 });
        expect(result.matches).toHaveLength(1);
        const snippet = result.matches[0].snippet;
        expect(snippet.length).toBeLessThanOrEqual(40);
        expect(snippet).toContain('needle');
    });
    it('matches case-insensitively in both query and text', () => {
        const result = grepText('Line with NEEDLE inside', 'needle');
        expect(result.totalMatches).toBe(1);
        const result2 = grepText('Line with needle inside', 'NEEDLE');
        expect(result2.totalMatches).toBe(1);
    });
    it('returns zero matches for empty text', () => {
        const result = grepText('', 'needle');
        expect(result).toEqual({ matches: [], totalMatches: 0, truncated: false });
    });
    it('returns zero matches for empty query', () => {
        const result = grepText('some text here', '');
        expect(result).toEqual({ matches: [], totalMatches: 0, truncated: false });
    });
});
//# sourceMappingURL=text-search.test.js.map