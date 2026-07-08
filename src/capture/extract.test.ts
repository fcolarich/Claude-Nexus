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
    promotion_target: 'none',
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
  promotion_target: 'none',
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

  it.each(['none', 'adr', 'ddr', 'best_practice', 'recipe', 'note'] as const)(
    'passes valid promotion_target %s through unchanged',
    (target) => {
      const out = parseCandidates(JSON.stringify([{ ...valid, promotion_target: target }]));
      expect(out).toHaveLength(1);
      expect(out[0].promotion_target).toBe(target);
    },
  );

  it('defaults promotion_target to none when field is missing', () => {
    const { promotion_target: _omitted, ...withoutTarget } = valid;
    const out = parseCandidates(JSON.stringify([withoutTarget]));
    expect(out).toHaveLength(1);
    expect(out[0].promotion_target).toBe('none');
  });

  it('defaults promotion_target to none for an invalid value', () => {
    const out = parseCandidates(JSON.stringify([{ ...valid, promotion_target: 'bogus' }]));
    expect(out).toHaveLength(1);
    expect(out[0].promotion_target).toBe('none');
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

  it('keeps a convention that merely contains a broad domain term', () => {
    const c = cand({ title: 'Knowledge extraction quality gate criteria', body: '3+ independent sources = high signal; refuse snippets without citation.', memory_type: 'convention' });
    const out = refineCandidates([c]);
    expect(out).toHaveLength(1);
    expect(out[0].memory_type).toBe('convention');
  });

  it('keeps a decision that cites an ADR but carries its own rationale', () => {
    const c = cand({
      title: 'Knockback persistence is intentional',
      body: 'Knockback persistence is deliberate game feel, tuned over playtests and retained against feedback; the direction aligns with ADR-040 on combat readability.',
      memory_type: 'decision',
    });
    const out = refineCandidates([c]);
    expect(out).toHaveLength(1);
    expect(out[0].memory_type).toBe('decision');
  });

  it('forces promotion_target to none on a restatement even if input had adr', () => {
    const c = cand({
      title: 'Project root resolution',
      body: 'Codified in ADR-051.',
      memory_type: 'decision',
      promotion_target: 'adr',
    });
    const out = refineCandidates([c]);
    expect(out).toHaveLength(1);
    expect(out[0].memory_type).toBe('reference');
    expect(out[0].promotion_target).toBe('none');
  });

  it('preserves promotion_target on a non-restatement candidate', () => {
    const c = cand({
      title: 'SQLite FTS5 for semantic search',
      body: 'Use SQLite FTS5 for full-text search. Avoids external search infra.',
      memory_type: 'insight',
      promotion_target: 'best_practice',
    });
    const out = refineCandidates([c]);
    expect(out).toHaveLength(1);
    expect(out[0].promotion_target).toBe('best_practice');
  });
});
