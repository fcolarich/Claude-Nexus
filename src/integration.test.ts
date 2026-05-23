/**
 * Integration tests — exercise the seams between modules: capture -> recall,
 * the review gate, decay -> recall drop-out -> verify, and consolidation.
 * Module internals are covered by the per-module unit tests.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openDatabase, initializeSchema } from './core/database.js';
import { reflect } from './capture/reflector.js';
import { recallMemories } from './core/recall.js';
import { insertMemory, verifyMemory, type MemoryInput } from './core/memories.js';
import { consolidateMemories } from './core/consolidate.js';
import type { MemoryCandidate } from './capture/extract.js';

function freshDb() {
  const db = openDatabase(':memory:');
  initializeSchema(db);
  return db;
}

function transcript(): string {
  const u = (c: string) => ({ type: 'user', message: { role: 'user', content: c } });
  const a = (t: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] } });
  const entries = [
    u("no, don't hardcode the path here"),
    a('Understood — I will make it configurable.'),
    u('also always run the linter before committing'),
    a('Noted.'),
  ];
  const dir = mkdtempSync(join(tmpdir(), 'nexus-int-'));
  const p = join(dir, 't.jsonl');
  writeFileSync(p, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return p;
}

function vecFromText(text: string): Float32Array {
  const v = new Float32Array(1024);
  let seed = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) seed = ((seed ^ text.charCodeAt(i)) * 16777619) >>> 0;
  for (let i = 0; i < 1024; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; v[i] = seed / 0xffffffff - 0.5; }
  return v;
}
const constVec = () => { const v = new Float32Array(1024); v.fill(0.1); return v; };
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

const candConvention: MemoryCandidate = {
  title: 'No hardcoded paths', body: 'Paths must be configurable, never hardcoded in source.',
  memory_type: 'convention', scope: 'project', decay_class: 'stable', confidence: 0.9, tags: ['config'],
};
const candPreference: MemoryCandidate = {
  title: 'Lint before commit', body: 'Always run the linter before committing changes.',
  memory_type: 'preference', scope: 'global', decay_class: 'stable', confidence: 0.9, tags: ['workflow'],
};

describe('integration: capture -> recall', () => {
  it('memories written by the Reflector are retrieved by recall', async () => {
    const db = freshDb();
    await reflect(db, { session_id: 's1', transcript_path: transcript(), project: 'proj' },
      { extract: async () => [candConvention, candPreference], embed: async (t) => vecFromText(t) });

    const r = recallMemories(db, { project: 'proj' });
    expect(r.items).toHaveLength(2);            // project-scoped + global, dual-bank
    expect(r.markdown).toContain('No hardcoded paths');
    expect(r.markdown).toContain('Lint before commit');
    db.close();
  });

  it('withholds pending memories from recall until approved', async () => {
    const db = freshDb();
    // confidence 0.5 < auto-approve threshold -> stored pending
    await reflect(db, { session_id: 's2', transcript_path: transcript(), project: 'proj' },
      { extract: async () => [{ ...candConvention, confidence: 0.5 }], embed: async (t) => vecFromText(t) });

    expect(recallMemories(db, { project: 'proj' }).items).toHaveLength(0);

    const id = (db.prepare(`SELECT id FROM memories LIMIT 1`).get() as { id: string }).id;
    db.prepare(`UPDATE memories SET review_status='approved' WHERE id=?`).run(id);
    expect(recallMemories(db, { project: 'proj' }).items).toHaveLength(1);
    db.close();
  });
});

describe('integration: decay lifecycle', () => {
  it('a decayed memory drops from recall and verify restores it', () => {
    const db = freshDb();
    const base: Omit<MemoryInput, 'title' | 'body'> = {
      memory_type: 'insight', scope: 'project', project: 'proj', confidence: 0.8,
      decay_class: 'implementation', review_status: 'approved',
      source_session_id: null, discovered_from: null, tags: [],
    };
    const { id } = insertMemory(db, { ...base, title: 'Impl detail', body: 'an implementation detail' });
    db.prepare(`UPDATE memories SET last_verified_at=? WHERE id=?`).run(daysAgo(400), id);

    expect(recallMemories(db, { project: 'proj' }).items).toHaveLength(0);  // decayed below threshold
    verifyMemory(db, id);
    expect(recallMemories(db, { project: 'proj' }).items).toHaveLength(1);  // decay clock reset
    db.close();
  });
});

describe('integration: consolidation', () => {
  it('merges duplicates so recall returns a single memory', async () => {
    const db = freshDb();
    const base: Omit<MemoryInput, 'title' | 'body'> = {
      memory_type: 'convention', scope: 'project', project: 'proj', confidence: 0.9,
      decay_class: 'stable', review_status: 'approved',
      source_session_id: null, discovered_from: null, tags: [],
    };
    insertMemory(db, { ...base, title: 'A', body: 'first phrasing of the rule', confidence: 0.9 });
    insertMemory(db, { ...base, title: 'B', body: 'second phrasing of the rule', confidence: 0.7 });

    await consolidateMemories(db, async () => constVec());  // identical embeddings -> near-dup
    expect(recallMemories(db, { project: 'proj' }).items).toHaveLength(1);
    db.close();
  });
});
