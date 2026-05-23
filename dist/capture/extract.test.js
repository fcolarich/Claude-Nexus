import { describe, it, expect } from 'vitest';
import { parseCandidates } from './extract.js';
const valid = {
    title: 'User prefers terse replies',
    body: 'The user wants compact answers with no preamble. Why: stated explicitly.',
    memory_type: 'preference',
    scope: 'global',
    decay_class: 'stable',
    confidence: 0.9,
    tags: ['style', 'communication'],
};
describe('parseCandidates', () => {
    it('parses a plain JSON array', () => {
        const out = parseCandidates(JSON.stringify([valid]));
        expect(out).toHaveLength(1);
        expect(out[0].memory_type).toBe('preference');
        expect(out[0].scope).toBe('global');
    });
    it('parses a fenced ```json block', () => {
        const out = parseCandidates('```json\n' + JSON.stringify([valid]) + '\n```');
        expect(out).toHaveLength(1);
    });
    it('parses an array embedded in prose', () => {
        const out = parseCandidates('Here are the memories:\n' + JSON.stringify([valid]) + '\nDone.');
        expect(out).toHaveLength(1);
    });
    it('drops items with an invalid memory_type', () => {
        const out = parseCandidates(JSON.stringify([{ ...valid, memory_type: 'nonsense' }]));
        expect(out).toHaveLength(0);
    });
    it('drops items missing title or body', () => {
        const out = parseCandidates(JSON.stringify([{ ...valid, body: '' }, { ...valid, title: '' }]));
        expect(out).toHaveLength(0);
    });
    it('clamps confidence into [0,1]', () => {
        const out = parseCandidates(JSON.stringify([
            { ...valid, confidence: 1.7 },
            { ...valid, body: 'different body text here', confidence: -3 },
        ]));
        expect(out[0].confidence).toBe(1);
        expect(out[1].confidence).toBe(0);
    });
    it('coerces a bad scope/decay_class to defaults', () => {
        const out = parseCandidates(JSON.stringify([{ ...valid, scope: 'weird', decay_class: 'weird' }]));
        expect(out[0].scope).toBe('project');
        expect(out[0].decay_class).toBe('implementation');
    });
    it('returns [] for empty or non-JSON input', () => {
        expect(parseCandidates('')).toEqual([]);
        expect(parseCandidates('not json at all')).toEqual([]);
        expect(parseCandidates('{}')).toEqual([]);
    });
});
//# sourceMappingURL=extract.test.js.map