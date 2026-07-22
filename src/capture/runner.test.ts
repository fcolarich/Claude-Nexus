import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { openDatabase, initializeSchema } from '../core/database.js';
import { insertMemory, recordFeedback } from '../core/memories.js';
import { runFeedbackPass } from './runner.js';

function freshDb(): Database.Database {
  const db = openDatabase(':memory:');
  initializeSchema(db);
  return db;
}

function seedMemory(db: Database.Database, id: string, title: string): void {
  db.prepare(`
    INSERT INTO memories (
      id, title, body, memory_type, scope, project, confidence, decay_class,
      last_verified_at, use_count, help_count, review_status, tags, content_hash,
      created_at, updated_at
    ) VALUES (?, ?, 'body text', 'insight', 'project', 'projA', 0.6, 'implementation',
      datetime('now'), 0, 0, 'approved', '[]', ?, datetime('now'), datetime('now'))
  `).run(id, title, `hash-${id}`);
}

describe('runFeedbackPass', () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexus-feedback-pass-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('records feedback for unevaluated ids and marks the state file evaluated', async () => {
    const db = freshDb();
    seedMemory(db, 'mem-1', 'Memory One');
    seedMemory(db, 'mem-2', 'Memory Two');
    writeFileSync(join(dir, 'sess-1.json'), JSON.stringify([
      { id: 'mem-1', evaluated: false },
      { id: 'mem-2', evaluated: false },
    ]));

    const haikuFn = async () => JSON.stringify([
      { id: 'mem-1', helped: true },
      { id: 'mem-2', helped: false },
    ]);

    await runFeedbackPass(db, 'sess-1', 'irrelevant transcript text', dir, haikuFn);

    const row1 = db.prepare(`SELECT use_count, help_count FROM memories WHERE id = 'mem-1'`).get() as { use_count: number; help_count: number };
    const row2 = db.prepare(`SELECT use_count, help_count FROM memories WHERE id = 'mem-2'`).get() as { use_count: number; help_count: number };
    expect(row1).toEqual({ use_count: 1, help_count: 1 });
    expect(row2).toEqual({ use_count: 1, help_count: 0 });

    const state = JSON.parse(readFileSync(join(dir, 'sess-1.json'), 'utf-8'));
    expect(state.every((e: { evaluated: boolean }) => e.evaluated === true)).toBe(true);

    db.close();
  });

  it('does nothing when there is no recall-state file for the session', async () => {
    const db = freshDb();
    let called = false;
    const haikuFn = async () => { called = true; return '[]'; };
    await runFeedbackPass(db, 'no-such-session', 'transcript', dir, haikuFn);
    expect(called).toBe(false);
    db.close();
  });

  it('skips ids already marked evaluated', async () => {
    const db = freshDb();
    seedMemory(db, 'mem-1', 'Memory One');
    writeFileSync(join(dir, 'sess-2.json'), JSON.stringify([{ id: 'mem-1', evaluated: true }]));
    let called = false;
    const haikuFn = async () => { called = true; return '[]'; };
    await runFeedbackPass(db, 'sess-2', 'transcript', dir, haikuFn);
    expect(called).toBe(false);
    db.close();
  });

  it('leaves ids unevaluated when the judge returns no verdicts (retried next firing)', async () => {
    const db = freshDb();
    seedMemory(db, 'mem-1', 'Memory One');
    writeFileSync(join(dir, 'sess-3.json'), JSON.stringify([{ id: 'mem-1', evaluated: false }]));
    const haikuFn = async () => 'not json';
    await runFeedbackPass(db, 'sess-3', 'transcript', dir, haikuFn);
    const state = JSON.parse(readFileSync(join(dir, 'sess-3.json'), 'utf-8'));
    expect(state[0].evaluated).toBe(false);
    const row = db.prepare(`SELECT use_count FROM memories WHERE id = 'mem-1'`).get() as { use_count: number };
    expect(row.use_count).toBe(0);
    db.close();
  });

  it('marks an id evaluated even if its memory row no longer exists', async () => {
    const db = freshDb();
    writeFileSync(join(dir, 'sess-4.json'), JSON.stringify([{ id: 'mem-deleted', evaluated: false }]));
    const haikuFn = async () => JSON.stringify([{ id: 'mem-deleted', helped: true }]);
    // mem-deleted has no row, so it can never be included in the judge's memory
    // list (runner only judges ids it can load) — verify it's still marked
    // evaluated rather than retried forever.
    await runFeedbackPass(db, 'sess-4', 'transcript', dir, haikuFn);
    const state = JSON.parse(readFileSync(join(dir, 'sess-4.json'), 'utf-8'));
    expect(state[0].evaluated).toBe(true);
    db.close();
  });
});
