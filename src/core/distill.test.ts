import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { insertMemory, type MemoryInput } from './memories.js';
import { distillMemories } from './distill.js';

function freshDb() {
  const db = openDatabase(':memory:');
  initializeSchema(db);
  return db;
}

/** Unit vectors with controlled cosine: A·B = 0.78 (related band), C orthogonal. */
function unit(...pairs: [number, number][]): Float32Array {
  const v = new Float32Array(1024);
  for (const [i, x] of pairs) v[i] = x;
  return v;
}
const vecA = unit([0, 1]);
const vecB = unit([0, 0.78], [1, Math.sqrt(1 - 0.78 * 0.78)]);
const vecC = unit([2, 1]);

// Keyed on a marker substring so `title\nbody` and `body` resolve to the same vec.
const fakeEmbed = (text: string): Promise<Float32Array | null> =>
  Promise.resolve(text.includes('ALPHA') ? vecA : text.includes('BETA') ? vecB : vecC);

const fakeMerge = async () => JSON.stringify({
  title: 'Merged rule', body: 'consolidated body', memory_type: 'convention',
  scope: 'project', decay_class: 'stable', tags: ['x'],
});

const base: Omit<MemoryInput, 'title' | 'body'> = {
  memory_type: 'convention', scope: 'project', project: 'p', confidence: 0.8,
  decay_class: 'stable', review_status: 'approved',
  source_session_id: null, discovered_from: null, tags: [],
};
const liveCount = (db: ReturnType<typeof freshDb>) =>
  (db.prepare(`SELECT COUNT(*) c FROM memories WHERE superseded_by IS NULL`).get() as { c: number }).c;

describe('distillMemories', () => {
  it('clusters related memories and merges each cluster into one', async () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'One', body: 'ALPHA first phrasing', confidence: 0.9 });
    insertMemory(db, { ...base, title: 'Two', body: 'BETA second phrasing', confidence: 0.7 });
    insertMemory(db, { ...base, title: 'Three', body: 'GAMMA unrelated thing' });

    const r = await distillMemories(db, fakeEmbed, fakeMerge);
    expect(r.clusters).toBe(1);
    expect(r.created).toBe(1);
    expect(r.merged).toBe(2);
    expect(liveCount(db)).toBe(2);  // the unrelated memory + the new merged one
    db.close();
  });

  it('leaves unrelated memories untouched', async () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'A', body: 'ALPHA only' });
    insertMemory(db, { ...base, title: 'C', body: 'GAMMA only' });

    const r = await distillMemories(db, fakeEmbed, fakeMerge);
    expect(r.clusters).toBe(0);
    expect(r.merged).toBe(0);
    expect(liveCount(db)).toBe(2);
    db.close();
  });
});
