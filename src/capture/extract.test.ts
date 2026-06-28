import { describe, it, expect } from 'vitest';
import { parseCandidates, refineCandidates, type MemoryCandidate } from './extract.js';

function cand(overrides: Partial<MemoryCandidate>): MemoryCandidate {
  return {
    title: 'Some durable fact',
    body: 'A reusable rule about the system and why it matters.',
    memory_type: 'insight',
    scope: 'project',
    decay_class: 'implementation',
    confidence: 0.8,
    tags: ['a'],
    ...overrides,
  };
}

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

  it('rejects handoff memory_type', () => {
    const raw = JSON.stringify([
      { title: 'Doc spine done', body: 'Scaffold created.', memory_type: 'handoff', scope: 'project', decay_class: 'implementation', confidence: 0.9, tags: [] },
    ]);
    expect(parseCandidates(raw)).toHaveLength(0);
  });
});

describe('refineCandidates', () => {
  it('drops completion / progress narration by title', () => {
    const c = cand({ title: 'Rumble Editor Tools doc spine initialized', memory_type: 'reference' });
    expect(refineCandidates([c])).toHaveLength(0);
  });

  it('drops completion narration by body', () => {
    const c = cand({ title: 'Assets folder', body: "Assets/ folder is now indexed for semantic search.", memory_type: 'reference' });
    expect(refineCandidates([c])).toHaveLength(0);
  });

  it('converts an ADR-citing decision into a reference pointer', () => {
    const c = cand({
      title: 'UPM package-per-tool baseline',
      body: 'Uses a UPM package-per-tool architecture. Codified in ADR-001 and DDR-001.',
      memory_type: 'decision',
    });
    const out = refineCandidates([c]);
    expect(out).toHaveLength(1);
    expect(out[0].memory_type).toBe('reference');
    expect(out[0].body).toContain('ADR-001');
    // the restated content is collapsed to a short pointer, not the full body
    expect(out[0].body.length).toBeLessThan(c.body.length + 10);
  });

  it('leaves a clean decision untouched', () => {
    const c = cand({ title: 'Odin soft dependency', body: 'Odin is a hard dependency only for some packages, not all.', memory_type: 'decision' });
    const out = refineCandidates([c]);
    expect(out).toHaveLength(1);
    expect(out[0].memory_type).toBe('decision');
  });
});
