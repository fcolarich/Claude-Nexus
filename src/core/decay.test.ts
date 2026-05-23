import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { insertMemory, type MemoryInput } from './memories.js';
import { decayFactor, effectiveConfidence, flagStaleMemories } from './decay.js';

/** SQLite-format datetime string N days in the past. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
}

describe('decayFactor', () => {
  it('never decays stable memories', () => {
    expect(decayFactor('stable', daysAgo(10_000))).toBe(1);
  });

  it('is 1 within the grace period', () => {
    expect(decayFactor('implementation', daysAgo(3))).toBe(1);  // 7d grace
    expect(decayFactor('architecture', daysAgo(25))).toBe(1);   // 30d grace
  });

  it('halves once per half-life past grace', () => {
    // implementation: 7d grace, 14d half-life — age 21 = one half-life past grace
    expect(decayFactor('implementation', daysAgo(21))).toBeCloseTo(0.5, 1);
    // architecture: 30d grace, 60d half-life — age 90 = one half-life past grace
    expect(decayFactor('architecture', daysAgo(90))).toBeCloseTo(0.5, 1);
  });

  it('approaches zero when very old', () => {
    expect(decayFactor('implementation', daysAgo(7 + 14 * 6))).toBeLessThan(0.02);
  });
});

describe('effectiveConfidence', () => {
  it('scales confidence by the decay factor', () => {
    expect(effectiveConfidence({ confidence: 0.8, decay_class: 'stable', last_verified_at: daysAgo(999) })).toBe(0.8);
    expect(effectiveConfidence({ confidence: 0.8, decay_class: 'implementation', last_verified_at: daysAgo(21) })).toBeCloseTo(0.4, 1);
  });
});

describe('flagStaleMemories', () => {
  const base: Omit<MemoryInput, 'title' | 'body'> = {
    memory_type: 'convention', scope: 'project', project: 'p', confidence: 0.8,
    decay_class: 'implementation', review_status: 'approved',
    source_session_id: null, discovered_from: null, tags: [],
  };

  it('flags decayed memories and rewrites stale diagnostics idempotently', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);

    insertMemory(db, { ...base, title: 'Fresh', body: 'a fresh memory' });
    const old = insertMemory(db, { ...base, title: 'Old', body: 'an old memory' });
    db.prepare(`UPDATE memories SET last_verified_at = ? WHERE id = ?`).run(daysAgo(500), old.id);

    expect(flagStaleMemories(db, 0.35)).toBe(1);
    const diags = db.prepare(`SELECT details FROM diagnostics WHERE type='stale'`).all() as { details: string }[];
    expect(diags).toHaveLength(1);
    expect(JSON.parse(diags[0].details).memory_id).toBe(old.id);

    // re-running must not accumulate duplicate diagnostics
    flagStaleMemories(db, 0.35);
    const count = (db.prepare(`SELECT COUNT(*) c FROM diagnostics WHERE type='stale'`).get() as { c: number }).c;
    expect(count).toBe(1);
    db.close();
  });
});
