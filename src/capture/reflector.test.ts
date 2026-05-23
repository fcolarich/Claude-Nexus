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
  memory_type: 'convention', scope: 'project', decay_class: 'stable', confidence: 0.9, tags: ['style'],
};
const candB: MemoryCandidate = {
  title: 'Async over promises', body: 'Prefer async/await syntax over raw promise chains for readability.',
  memory_type: 'preference', scope: 'global', decay_class: 'stable', confidence: 0.9, tags: ['style'],
};
const candC: MemoryCandidate = {
  title: 'No globals restated', body: 'Global state is discouraged here — inject dependencies through constructors.',
  memory_type: 'convention', scope: 'project', decay_class: 'stable', confidence: 0.9, tags: ['style'],
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
});
