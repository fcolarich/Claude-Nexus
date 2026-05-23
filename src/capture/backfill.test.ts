import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { openDatabase, initializeSchema } from '../core/database.js';
import { selectBackfillSessions, backfillSessions } from './backfill.js';
import type { MemoryCandidate } from './extract.js';

function freshDb() {
  const db = openDatabase(':memory:');
  initializeSchema(db);
  return db;
}

function insertSession(
  db: Database.Database,
  o: { id: string; project?: string; messages?: number; reflected?: number; jsonl?: string }
) {
  db.prepare(`
    INSERT INTO sessions (session_id, project, jsonl_path, status, message_count, last_reflected_index)
    VALUES (?, ?, ?, 'dead', ?, ?)
  `).run(o.id, o.project ?? 'p', o.jsonl ?? '/nonexistent.jsonl', o.messages ?? 20, o.reflected ?? 0);
}

function makeTranscript(): string {
  const u = (c: string) => ({ type: 'user', message: { role: 'user', content: c } });
  const a = (t: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] } });
  const entries = [u("no, don't hardcode that"), a('ok'), u('always lint first'), a('noted')];
  const p = join(mkdtempSync(join(tmpdir(), 'nexus-bf-')), 't.jsonl');
  writeFileSync(p, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return p;
}

describe('selectBackfillSessions', () => {
  it('selects only un-analyzed sessions above the message floor', () => {
    const db = freshDb();
    insertSession(db, { id: 'fresh', messages: 20, reflected: 0 });
    insertSession(db, { id: 'tiny', messages: 2, reflected: 0 });
    insertSession(db, { id: 'done', messages: 20, reflected: 50 });
    expect(selectBackfillSessions(db, { minMessages: 8 }).map(s => s.session_id)).toEqual(['fresh']);
    db.close();
  });

  it('force includes already-analyzed sessions', () => {
    const db = freshDb();
    insertSession(db, { id: 'done', messages: 20, reflected: 50 });
    expect(selectBackfillSessions(db, {}).length).toBe(0);
    expect(selectBackfillSessions(db, { force: true }).length).toBe(1);
    db.close();
  });

  it('filters by project and respects the limit', () => {
    const db = freshDb();
    insertSession(db, { id: 'a', project: 'x', messages: 20 });
    insertSession(db, { id: 'b', project: 'y', messages: 20 });
    expect(selectBackfillSessions(db, { project: 'x' }).map(s => s.session_id)).toEqual(['a']);
    expect(selectBackfillSessions(db, { limit: 1 }).length).toBe(1);
    db.close();
  });
});

describe('backfillSessions', () => {
  it('dry run reports the selection without processing', async () => {
    const db = freshDb();
    insertSession(db, { id: 's1', messages: 20 });
    const r = await backfillSessions(db, { dryRun: true });
    expect(r.selected).toBe(1);
    expect(r.processed).toBe(0);
    expect(r.dryRun).toBe(true);
    db.close();
  });

  it('runs the Reflector over selected past sessions', async () => {
    const db = freshDb();
    insertSession(db, { id: 's1', messages: 20, jsonl: makeTranscript() });
    const cand: MemoryCandidate = {
      title: 'No hardcoding', body: 'never hardcode paths in source', memory_type: 'convention',
      scope: 'project', decay_class: 'stable', confidence: 0.9, tags: [],
    };
    const r = await backfillSessions(db, {}, {
      extract: async () => [cand],
      embed: async () => { const v = new Float32Array(1024); v.fill(0.1); return v; },
    });
    expect(r.processed).toBe(1);
    expect(r.inserted).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) c FROM memories`).get() as { c: number }).c).toBe(1);
    db.close();
  });
});
