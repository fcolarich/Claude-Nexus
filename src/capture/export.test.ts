import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openDatabase, initializeSchema } from '../core/database.js';
import { insertMemory } from '../core/memories.js';
import { exportAll } from './export.js';

function freshDb() {
  const db = openDatabase(':memory:');
  initializeSchema(db);
  return db;
}

const base = {
  scope: 'project' as const,
  project: 'proj',
  confidence: 0.9,
  decay_class: 'stable' as const,
  source_session_id: null,
  discovered_from: null,
  tags: ['t'],
  promotion_target: 'none' as const,
};

describe('exportAll', () => {
  it('exports only approved memories, with an index', () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'Approved one', body: 'An approved memory body.', memory_type: 'convention', review_status: 'approved' });
    insertMemory(db, { ...base, title: 'Pending one', body: 'A pending memory body.', memory_type: 'insight', review_status: 'pending' });

    const dir = mkdtempSync(join(tmpdir(), 'nexus-exp-'));
    const result = exportAll(db, dir);

    expect(result.buckets).toBe(1);
    const projDir = join(dir, 'proj', 'memory');
    expect(existsSync(join(projDir, 'MEMORY.md'))).toBe(true);

    const mdFiles = readdirSync(projDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
    expect(mdFiles).toHaveLength(1); // pending one not exported

    const index = readFileSync(join(projDir, 'MEMORY.md'), 'utf-8');
    expect(index).toContain('Approved one');
    expect(index).not.toContain('Pending one');

    const memFile = readFileSync(join(projDir, mdFiles[0]), 'utf-8');
    expect(memFile).toContain('# Approved one');
    expect(memFile).toContain('memory_type: convention');
    db.close();
  });

  it('routes global-scope memories to the _global bucket', () => {
    const db = freshDb();
    insertMemory(db, { ...base, scope: 'global', project: null, title: 'Global pref', body: 'A global preference.', memory_type: 'preference', review_status: 'approved' });

    const dir = mkdtempSync(join(tmpdir(), 'nexus-exp-'));
    exportAll(db, dir);
    expect(existsSync(join(dir, '_global', 'memory', 'MEMORY.md'))).toBe(true);
    db.close();
  });

  it('prunes a stale bucket directory that no longer has any live memories', () => {
    const db = freshDb();
    insertMemory(db, { ...base, project: 'live-proj', title: 'Still here', body: 'kept.', memory_type: 'convention', review_status: 'approved' });

    const dir = mkdtempSync(join(tmpdir(), 'nexus-exp-'));
    mkdirSync(join(dir, 'stale-proj', 'memory'), { recursive: true });
    writeFileSync(join(dir, 'stale-proj', 'memory', 'MEMORY.md'), '# stale');

    exportAll(db, dir);

    expect(existsSync(join(dir, 'stale-proj'))).toBe(false);
    expect(existsSync(join(dir, 'live-proj', 'memory', 'MEMORY.md'))).toBe(true);
    db.close();
  });

  it('never deletes a project directory that still holds a session .jsonl', () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'nexus-exp-'));
    mkdirSync(join(dir, 'still-active-sessions', 'memory'), { recursive: true });
    writeFileSync(join(dir, 'still-active-sessions', 'memory', 'MEMORY.md'), '# stale');
    writeFileSync(join(dir, 'still-active-sessions', 'abc123.jsonl'), '{}');

    exportAll(db, dir);

    expect(existsSync(join(dir, 'still-active-sessions', 'abc123.jsonl'))).toBe(true);
    expect(existsSync(join(dir, 'still-active-sessions', 'memory'))).toBe(false);
    db.close();
  });

  it('caps MEMORY.md index at memory_md_max_items (200) and appends a pointer line on overflow', () => {
    const db = freshDb();
    const total = 205;
    // Insert 205 approved stable memories with unique confidence values 1..205.
    // decay_class stable => effectiveConfidence = confidence, so rank order is deterministic.
    for (let i = 1; i <= total; i++) {
      insertMemory(db, {
        ...base,
        title: `Cap Mem ${i}`,
        body: `cap body unique ${i}`,
        memory_type: 'convention',
        review_status: 'approved',
        confidence: i,  // i=1 is lowest rank, i=205 is highest
      });
    }

    const dir = mkdtempSync(join(tmpdir(), 'nexus-exp-'));
    exportAll(db, dir);

    const index = readFileSync(join(dir, 'proj', 'memory', 'MEMORY.md'), 'utf-8');
    const entryLines = index.split('\n').filter((l) => l.startsWith('- ['));
    expect(entryLines).toHaveLength(200);

    // Bottom 5 (confidence 1..5) must be cut. Bracket-anchor the title so
    // "Cap Mem 1" doesn't false-match as a substring of "Cap Mem 100"..."Cap Mem 199".
    for (let i = 1; i <= 5; i++) {
      expect(index).not.toContain(`[Cap Mem ${i}]`);
    }
    // Top entries (confidence 6..205) must be retained
    expect(index).toContain('[Cap Mem 6]');
    expect(index).toContain('[Cap Mem 205]');

    // Exactly one pointer line with correct remaining count
    const pointerLines = index.split('\n').filter((l) => l.startsWith('> …'));
    expect(pointerLines).toHaveLength(1);
    expect(pointerLines[0]).toBe('> … 5 more memories — use nexus_search to retrieve them.');
    db.close();
  });

  it('writes no pointer line when entry count is under the cap', () => {
    const db = freshDb();
    for (let i = 1; i <= 10; i++) {
      insertMemory(db, {
        ...base,
        title: `Under Mem ${i}`,
        body: `under body unique ${i}`,
        memory_type: 'convention',
        review_status: 'approved',
        confidence: i * 0.05,
      });
    }

    const dir = mkdtempSync(join(tmpdir(), 'nexus-exp-'));
    exportAll(db, dir);

    const index = readFileSync(join(dir, 'proj', 'memory', 'MEMORY.md'), 'utf-8');
    const entryLines = index.split('\n').filter((l) => l.startsWith('- ['));
    expect(entryLines).toHaveLength(10);
    expect(index).not.toContain('more memories');
    db.close();
  });

  it('does not rewrite an existing exported file even if its on-disk content diverges from the DB (full export is fill-missing only)', () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'Stable one', body: 'original body.', memory_type: 'convention', review_status: 'approved' });
    const dir = mkdtempSync(join(tmpdir(), 'nexus-exp-'));
    exportAll(db, dir);

    const projDir = join(dir, 'proj', 'memory');
    const memFiles = readdirSync(projDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
    const fpath = join(projDir, memFiles[0]);
    writeFileSync(fpath, 'MANUALLY EDITED CONTENT');

    exportAll(db, dir);

    expect(readFileSync(fpath, 'utf-8')).toBe('MANUALLY EDITED CONTENT');
    db.close();
  });

  it('touchedIds scope writes only the touched memory files, unconditionally, and rebuilds that bucket index from the DB', () => {
    const db = freshDb();
    const { id: id1 } = insertMemory(db, { ...base, title: 'Mem One', body: 'body one', memory_type: 'convention', review_status: 'approved' });
    insertMemory(db, { ...base, title: 'Mem Two', body: 'body two', memory_type: 'convention', review_status: 'approved' });
    const dir = mkdtempSync(join(tmpdir(), 'nexus-exp-'));
    exportAll(db, dir);

    db.prepare('UPDATE memories SET body = ? WHERE id = ?').run('body one UPDATED', id1);

    exportAll(db, dir, { touchedIds: [id1] });

    const projDir = join(dir, 'proj', 'memory');
    const f1 = readdirSync(projDir).find((f) => f.startsWith(id1));
    expect(readFileSync(join(projDir, f1!), 'utf-8')).toContain('body one UPDATED');

    const index = readFileSync(join(projDir, 'MEMORY.md'), 'utf-8');
    expect(index).toContain('Mem One');
    expect(index).toContain('Mem Two');
    db.close();
  });

  it('touchedIds scope removes the on-disk file for a touched memory that became superseded', () => {
    const db = freshDb();
    const { id: oldId } = insertMemory(db, { ...base, title: 'Old One', body: 'old body', memory_type: 'convention', review_status: 'approved' });
    const dir = mkdtempSync(join(tmpdir(), 'nexus-exp-'));
    exportAll(db, dir);

    const { id: newId } = insertMemory(db, { ...base, title: 'New One', body: 'new body', memory_type: 'convention', review_status: 'approved' });
    db.prepare('UPDATE memories SET superseded_by = ? WHERE id = ?').run(newId, oldId);

    exportAll(db, dir, { touchedIds: [oldId, newId] });

    const projDir = join(dir, 'proj', 'memory');
    expect(readdirSync(projDir).some((f) => f.startsWith(oldId))).toBe(false);
    db.close();
  });

  it('touchedIds scope skips orphan bucket pruning', () => {
    const db = freshDb();
    const { id } = insertMemory(db, { ...base, project: 'live-proj', title: 'Kept', body: 'kept body', memory_type: 'convention', review_status: 'approved' });
    const dir = mkdtempSync(join(tmpdir(), 'nexus-exp-'));
    mkdirSync(join(dir, 'stale-proj', 'memory'), { recursive: true });
    writeFileSync(join(dir, 'stale-proj', 'memory', 'MEMORY.md'), '# stale');

    exportAll(db, dir, { touchedIds: [id] });

    expect(existsSync(join(dir, 'stale-proj'))).toBe(true);
    db.close();
  });

  it('touchedIds scope only processes buckets containing touched memories', () => {
    const db = freshDb();
    const { id: idA } = insertMemory(db, { ...base, project: 'proj-a', title: 'A', body: 'a body', memory_type: 'convention', review_status: 'approved' });
    insertMemory(db, { ...base, project: 'proj-b', title: 'B', body: 'b body', memory_type: 'convention', review_status: 'approved' });
    const dir = mkdtempSync(join(tmpdir(), 'nexus-exp-'));

    const result = exportAll(db, dir, { touchedIds: [idA] });

    expect(result.buckets).toBe(1);
    expect(existsSync(join(dir, 'proj-b'))).toBe(false);
    db.close();
  });

  it('touchedIds scope writes no file and does not count a bucket for a touched memory that is not approved', () => {
    const db = freshDb();
    const { id } = insertMemory(db, { ...base, title: 'Pending', body: 'pending body', memory_type: 'convention', review_status: 'pending' });
    const dir = mkdtempSync(join(tmpdir(), 'nexus-exp-'));

    const result = exportAll(db, dir, { touchedIds: [id] });

    expect(result.files).toBe(0);
    expect(result.buckets).toBe(0);
    db.close();
  });

  it('writes no pointer line when entry count is exactly at the cap (strict >)', () => {
    const db = freshDb();
    const cap = 200;
    for (let i = 1; i <= cap; i++) {
      insertMemory(db, {
        ...base,
        title: `Exact Mem ${i}`,
        body: `exact body unique ${i}`,
        memory_type: 'convention',
        review_status: 'approved',
        confidence: i * 0.004,
      });
    }

    const dir = mkdtempSync(join(tmpdir(), 'nexus-exp-'));
    exportAll(db, dir);

    const index = readFileSync(join(dir, 'proj', 'memory', 'MEMORY.md'), 'utf-8');
    const entryLines = index.split('\n').filter((l) => l.startsWith('- ['));
    expect(entryLines).toHaveLength(cap);
    expect(index).not.toContain('more memories');
    db.close();
  });
});
