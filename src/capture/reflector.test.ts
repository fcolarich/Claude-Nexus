import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openDatabase, initializeSchema } from '../core/database.js';
import { reflect } from './reflector.js';
import type { MemoryCandidate } from './extract.js';

function makeTranscript(entries: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-rx-'));
  const p = join(dir, 'transcript.jsonl');
  writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return p;
}
const userMsg = (content: unknown) => ({ type: 'user', message: { role: 'user', content } });
const asstMsg = (content: unknown) => ({ type: 'assistant', message: { role: 'assistant', content } });

// A transcript that passes the Observer gate (contains a correction marker).
const SIGNAL_TRANSCRIPT = [
  userMsg("no, don't use global variables here"),
  asstMsg([{ type: 'text', text: 'Understood — dependency injection instead.' }]),
  userMsg('also prefer async/await over raw promises'),
  asstMsg([{ type: 'text', text: 'Noted.' }]),
];

/** Deterministic distinct pseudo-vector per text. */
function vecFromText(text: string): Float32Array {
  const v = new Float32Array(1024);
  let seed = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) seed = ((seed ^ text.charCodeAt(i)) * 16777619) >>> 0;
  for (let i = 0; i < 1024; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    v[i] = seed / 0xffffffff - 0.5;
  }
  return v;
}
const FIXED_VEC = (() => {
  const v = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) v[i] = ((i % 7) + 1) / 10;
  return v;
})();

const candA: MemoryCandidate = {
  title: 'No global variables', body: 'Avoid global variables in this project; use dependency injection instead.',
  memory_type: 'convention', scope: 'project', decay_class: 'stable', confidence: 0.9, tags: ['style'], promotion_target: 'none',
};
const candB: MemoryCandidate = {
  title: 'Async over promises', body: 'Prefer async/await syntax over raw promise chains for readability.',
  memory_type: 'preference', scope: 'global', decay_class: 'stable', confidence: 0.9, tags: ['style'], promotion_target: 'none',
};
const candC: MemoryCandidate = {
  title: 'No globals restated', body: 'Global state is discouraged here — inject dependencies through constructors.',
  memory_type: 'convention', scope: 'project', decay_class: 'stable', confidence: 0.9, tags: ['style'], promotion_target: 'none',
};

function freshDb() {
  const db = openDatabase(':memory:');
  initializeSchema(db);
  return db;
}
const countMemories = (db: ReturnType<typeof freshDb>) =>
  (db.prepare(`SELECT COUNT(*) AS c FROM memories`).get() as { c: number }).c;

describe('reflect', () => {
  it('extracts and inserts distinct memories, advancing the cursor', async () => {
    const db = freshDb();
    const p = makeTranscript(SIGNAL_TRANSCRIPT);
    const r = await reflect(db, { session_id: 's1', transcript_path: p, project: 'proj' },
      { extract: async () => [candA, candB], embed: async (t) => vecFromText(t) });

    expect(r.skipped).toBe(false);
    expect(r.inserted).toBe(2);
    expect(r.merged).toBe(0);
    expect(countMemories(db)).toBe(2);

    const cursor = (db.prepare(`SELECT last_reflected_index FROM sessions WHERE session_id='s1'`).get() as { last_reflected_index: number }).last_reflected_index;
    expect(cursor).toBe(SIGNAL_TRANSCRIPT.length);

    const approved = (db.prepare(`SELECT COUNT(*) AS c FROM memories WHERE review_status='approved'`).get() as { c: number }).c;
    expect(approved).toBe(2); // confidence 0.9 >= auto-approve threshold
    db.close();
  });

  it('skips a trivial window via the Observer gate', async () => {
    const db = freshDb();
    const p = makeTranscript([userMsg('hi')]);
    const r = await reflect(db, { session_id: 's2', transcript_path: p, project: 'proj' },
      { extract: async () => [candA], embed: async (t) => vecFromText(t) });

    expect(r.skipped).toBe(true);
    expect(r.inserted).toBe(0);
    expect(countMemories(db)).toBe(0);
    db.close();
  });

  it('does not re-process transcript lines on a second run', async () => {
    const db = freshDb();
    const p = makeTranscript(SIGNAL_TRANSCRIPT);
    const deps = { extract: async () => [candA], embed: async (t: string) => vecFromText(t) };

    await reflect(db, { session_id: 's3', transcript_path: p, project: 'proj' }, deps);
    const r2 = await reflect(db, { session_id: 's3', transcript_path: p, project: 'proj' }, deps);

    expect(r2.skipped).toBe(true);
    expect(r2.newLines).toBe(0);
    expect(countMemories(db)).toBe(1);
    db.close();
  });

  it('merges an exact-duplicate candidate instead of re-inserting', async () => {
    const db = freshDb();
    const p = makeTranscript(SIGNAL_TRANSCRIPT);
    const r = await reflect(db, { session_id: 's4', transcript_path: p, project: 'proj' },
      { extract: async () => [candA, candA], embed: async (t) => vecFromText(t) });

    expect(r.inserted).toBe(1);
    expect(r.merged).toBe(1);
    expect(countMemories(db)).toBe(1);
    db.close();
  });

  it('merges a semantically near-duplicate candidate', async () => {
    const db = freshDb();
    const p = makeTranscript(SIGNAL_TRANSCRIPT);
    // Fixed embedder => every memory embeds identically => second candidate is a near-dup.
    const r = await reflect(db, { session_id: 's5', transcript_path: p, project: 'proj' },
      { extract: async () => [candA, candC], embed: async () => FIXED_VEC });

    expect(r.inserted).toBe(1);
    expect(r.merged).toBe(1);
    expect(countMemories(db)).toBe(1);
    db.close();
  });

  it('marks low-confidence memories pending review', async () => {
    const db = freshDb();
    const p = makeTranscript(SIGNAL_TRANSCRIPT);
    await reflect(db, { session_id: 's6', transcript_path: p, project: 'proj' },
      { extract: async () => [{ ...candA, confidence: 0.5 }], embed: async (t) => vecFromText(t) });

    const status = (db.prepare(`SELECT review_status FROM memories LIMIT 1`).get() as { review_status: string }).review_status;
    expect(status).toBe('pending');
    db.close();
  });

  it('passes vcc-compacted text to extract() when compactWindowLines succeeds', async () => {
    const db = freshDb();
    const p = makeTranscript(SIGNAL_TRANSCRIPT);
    let receivedText = '';
    const fakeVcc = {
      compactWindowLines: () => ({ ok: true as const, text: 'compacted' }),
      compactFileInPlace: () => ({ ok: true as const, text: 'shrunk' }),
    };

    await reflect(db, { session_id: 's7', transcript_path: p, project: 'proj' }, {
      extract: async (text) => { receivedText = text; return [candA]; },
      embed: async (t) => vecFromText(t),
      vcc: fakeVcc,
    });

    expect(receivedText).toBe('compacted');
    db.close();
  });

  it('falls back to window.text when compactWindowLines fails', async () => {
    const db = freshDb();
    const p = makeTranscript(SIGNAL_TRANSCRIPT);
    let receivedText = '';
    const fakeVcc = {
      compactWindowLines: () => ({ ok: false as const, error: 'boom' }),
      compactFileInPlace: () => ({ ok: true as const, text: 'shrunk' }),
    };

    await reflect(db, { session_id: 's8', transcript_path: p, project: 'proj' }, {
      extract: async (text) => { receivedText = text; return [candA]; },
      embed: async (t) => vecFromText(t),
      vcc: fakeVcc,
    });

    expect(receivedText).toContain("no, don't use global variables here");
    db.close();
  });

  it('sets sessions.vcc_shrunk_at after a full reflect() pass when compactFileInPlace succeeds', async () => {
    const db = freshDb();
    const p = makeTranscript(SIGNAL_TRANSCRIPT);
    const fakeVcc = {
      compactWindowLines: () => ({ ok: true as const, text: 'compacted' }),
      compactFileInPlace: () => ({ ok: true as const, text: 'shrunk' }),
    };

    await reflect(db, { session_id: 's9', transcript_path: p, project: 'proj' },
      { extract: async () => [candA], embed: async (t) => vecFromText(t), vcc: fakeVcc });

    const row = db.prepare(`SELECT vcc_shrunk_at FROM sessions WHERE session_id = 's9'`).get() as { vcc_shrunk_at: string | null };
    expect(row.vcc_shrunk_at).not.toBeNull();
    db.close();
  });

  it('leaves sessions.vcc_shrunk_at NULL when compactFileInPlace fails', async () => {
    const db = freshDb();
    const p = makeTranscript(SIGNAL_TRANSCRIPT);
    const fakeVcc = {
      compactWindowLines: () => ({ ok: true as const, text: 'compacted' }),
      compactFileInPlace: () => ({ ok: false as const, error: 'boom' }),
    };

    await reflect(db, { session_id: 's10', transcript_path: p, project: 'proj' },
      { extract: async () => [candA], embed: async (t) => vecFromText(t), vcc: fakeVcc });

    const row = db.prepare(`SELECT vcc_shrunk_at FROM sessions WHERE session_id = 's10'`).get() as { vcc_shrunk_at: string | null };
    expect(row.vcc_shrunk_at).toBeNull();
    db.close();
  });

  it('never invokes compactFileInPlace on a gate-skipped (trivial) window', async () => {
    const db = freshDb();
    const p = makeTranscript([userMsg('hi')]);
    let shrinkCalled = false;
    const fakeVcc = {
      compactWindowLines: () => ({ ok: true as const, text: 'compacted' }),
      compactFileInPlace: () => { shrinkCalled = true; return { ok: true as const, text: 'shrunk' }; },
    };

    const r = await reflect(db, { session_id: 's11', transcript_path: p, project: 'proj' },
      { extract: async () => [candA], embed: async (t) => vecFromText(t), vcc: fakeVcc });

    expect(r.skipped).toBe(true);
    expect(shrinkCalled).toBe(false);
    db.close();
  });

  describe('Fix 1 — ADR-reference demotion (supersede-insert)', () => {
    const decisionCand: MemoryCandidate = {
      title: 'Use supersede-insert', body: 'Chose supersede-insert to preserve content-addressing on dedup upgrade.',
      memory_type: 'decision', scope: 'project', decay_class: 'architecture', confidence: 0.9, tags: ['arch'], promotion_target: 'adr',
    };
    const refCand: MemoryCandidate = {
      title: 'Supersede-insert pointer', body: 'Supersede-insert dedup upgrade decision → ADR-042',
      memory_type: 'reference', scope: 'project', decay_class: 'architecture', confidence: 0.9, tags: ['arch'], promotion_target: 'none',
    };
    const noRefCand: MemoryCandidate = {
      title: 'Some pointer', body: 'A reference candidate with no ADR/DDR id in the body at all.',
      memory_type: 'reference', scope: 'project', decay_class: 'architecture', confidence: 0.9, tags: ['arch'], promotion_target: 'none',
    };

    it('happy path — upgrades a decision to a reference when a real ADR id is later cited', async () => {
      const db = freshDb();
      const p1 = makeTranscript(SIGNAL_TRANSCRIPT);
      const r1 = await reflect(db, { session_id: 'u1', transcript_path: p1, project: 'proj' },
        { extract: async () => [decisionCand], embed: async () => FIXED_VEC });
      expect(r1.inserted).toBe(1);

      const decisionId = (db.prepare(`SELECT id FROM memories WHERE memory_type = 'decision'`).get() as { id: string }).id;

      const p2 = makeTranscript(SIGNAL_TRANSCRIPT);
      const r2 = await reflect(db, { session_id: 'u2', transcript_path: p2, project: 'proj' },
        { extract: async () => [refCand], embed: async () => FIXED_VEC });

      expect(r2.upgraded).toBe(1);
      expect(r2.merged).toBe(0);

      const decisionRow = db.prepare(`SELECT superseded_by FROM memories WHERE id = ?`).get(decisionId) as { superseded_by: string | null };
      expect(decisionRow.superseded_by).not.toBeNull();

      const newRow = db.prepare(`SELECT id FROM memories WHERE memory_type = 'reference'`).get() as { id: string } | undefined;
      expect(newRow?.id).toBe(decisionRow.superseded_by);

      const queueCount = (db.prepare(
        `SELECT COUNT(*) AS c FROM memories WHERE promotion_target != 'none' AND promoted_to IS NULL AND superseded_by IS NULL`
      ).get() as { c: number }).c;
      expect(queueCount).toBe(0);
      db.close();
    });

    it('negative — reference candidate has no ADR/DDR id in the body: touch-only', async () => {
      const db = freshDb();
      const p1 = makeTranscript(SIGNAL_TRANSCRIPT);
      await reflect(db, { session_id: 'v1', transcript_path: p1, project: 'proj' },
        { extract: async () => [decisionCand], embed: async () => FIXED_VEC });
      const decisionId = (db.prepare(`SELECT id FROM memories WHERE memory_type = 'decision'`).get() as { id: string }).id;

      const p2 = makeTranscript(SIGNAL_TRANSCRIPT);
      const r2 = await reflect(db, { session_id: 'v2', transcript_path: p2, project: 'proj' },
        { extract: async () => [noRefCand], embed: async () => FIXED_VEC });

      expect(r2.merged).toBe(1);
      expect(r2.upgraded).toBe(0);
      const decisionRow = db.prepare(`SELECT superseded_by FROM memories WHERE id = ?`).get(decisionId) as { superseded_by: string | null };
      expect(decisionRow.superseded_by).toBeNull();
      db.close();
    });

    it('negative — matched row is not a decision (e.g. convention): touch-only', async () => {
      const db = freshDb();
      const conventionCand: MemoryCandidate = { ...candA }; // memory_type: 'convention'
      const p1 = makeTranscript(SIGNAL_TRANSCRIPT);
      await reflect(db, { session_id: 'w1', transcript_path: p1, project: 'proj' },
        { extract: async () => [conventionCand], embed: async () => FIXED_VEC });
      const conventionId = (db.prepare(`SELECT id FROM memories WHERE memory_type = 'convention'`).get() as { id: string }).id;

      const p2 = makeTranscript(SIGNAL_TRANSCRIPT);
      const r2 = await reflect(db, { session_id: 'w2', transcript_path: p2, project: 'proj' },
        { extract: async () => [refCand], embed: async () => FIXED_VEC });

      expect(r2.merged).toBe(1);
      expect(r2.upgraded).toBe(0);
      const conventionRow = db.prepare(`SELECT superseded_by FROM memories WHERE id = ?`).get(conventionId) as { superseded_by: string | null };
      expect(conventionRow.superseded_by).toBeNull();
      db.close();
    });

    it('positive — broadened trigger: promotion_target=\'none\' decision row also gets superseded', async () => {
      const db = freshDb();
      const noneDecisionCand: MemoryCandidate = { ...decisionCand, promotion_target: 'none' };
      const p1 = makeTranscript(SIGNAL_TRANSCRIPT);
      await reflect(db, { session_id: 'x1', transcript_path: p1, project: 'proj' },
        { extract: async () => [noneDecisionCand], embed: async () => FIXED_VEC });
      const decisionId = (db.prepare(`SELECT id FROM memories WHERE memory_type = 'decision'`).get() as { id: string }).id;

      const p2 = makeTranscript(SIGNAL_TRANSCRIPT);
      const r2 = await reflect(db, { session_id: 'x2', transcript_path: p2, project: 'proj' },
        { extract: async () => [refCand], embed: async () => FIXED_VEC });

      expect(r2.upgraded).toBe(1);
      expect(r2.merged).toBe(0);
      const decisionRow = db.prepare(`SELECT superseded_by FROM memories WHERE id = ?`).get(decisionId) as { superseded_by: string | null };
      expect(decisionRow.superseded_by).not.toBeNull();
      db.close();
    });

    it('idempotency / convergence — a third window matching the reference row is touch-only, no re-supersede', async () => {
      const db = freshDb();
      const p1 = makeTranscript(SIGNAL_TRANSCRIPT);
      await reflect(db, { session_id: 'y1', transcript_path: p1, project: 'proj' },
        { extract: async () => [decisionCand], embed: async () => FIXED_VEC });

      const p2 = makeTranscript(SIGNAL_TRANSCRIPT);
      const r2 = await reflect(db, { session_id: 'y2', transcript_path: p2, project: 'proj' },
        { extract: async () => [refCand], embed: async () => FIXED_VEC });
      expect(r2.upgraded).toBe(1);
      expect(countMemories(db)).toBe(2); // decision (superseded) + reference

      const referenceId = (db.prepare(`SELECT id FROM memories WHERE memory_type = 'reference'`).get() as { id: string }).id;

      const p3 = makeTranscript(SIGNAL_TRANSCRIPT);
      const r3 = await reflect(db, { session_id: 'y3', transcript_path: p3, project: 'proj' },
        { extract: async () => [refCand], embed: async () => FIXED_VEC });

      expect(r3.upgraded).toBe(0);
      expect(r3.merged).toBe(1);
      expect(r3.inserted).toBe(0);
      expect(countMemories(db)).toBe(2); // no new row, no second supersede
      const referenceRow = db.prepare(`SELECT superseded_by FROM memories WHERE id = ?`).get(referenceId) as { superseded_by: string | null };
      expect(referenceRow.superseded_by).toBeNull();
      db.close();
    });

    it('rollback — a throw during the supersede UPDATE persists neither the new row nor superseded_by', async () => {
      const db = freshDb();
      const p1 = makeTranscript(SIGNAL_TRANSCRIPT);
      await reflect(db, { session_id: 'z1', transcript_path: p1, project: 'proj' },
        { extract: async () => [decisionCand], embed: async () => FIXED_VEC });
      const decisionId = (db.prepare(`SELECT id FROM memories WHERE memory_type = 'decision'`).get() as { id: string }).id;
      const beforeCount = countMemories(db);

      const originalPrepare = db.prepare.bind(db);
      const spy = (sql: string, ...args: unknown[]) => {
        if (sql.includes('SET superseded_by')) {
          throw new Error('boom — forced supersede failure');
        }
        return originalPrepare(sql, ...args);
      };
      (db as unknown as { prepare: typeof db.prepare }).prepare = spy as unknown as typeof db.prepare;

      const p2 = makeTranscript(SIGNAL_TRANSCRIPT);
      await expect(reflect(db, { session_id: 'z2', transcript_path: p2, project: 'proj' },
        { extract: async () => [refCand], embed: async () => FIXED_VEC })).rejects.toThrow();

      (db as unknown as { prepare: typeof db.prepare }).prepare = originalPrepare;

      expect(countMemories(db)).toBe(beforeCount); // no new reference row persisted
      const decisionRow = db.prepare(`SELECT superseded_by FROM memories WHERE id = ?`).get(decisionId) as { superseded_by: string | null };
      expect(decisionRow.superseded_by).toBeNull();
      db.close();
    });
  });
});
