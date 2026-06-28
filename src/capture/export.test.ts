import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readdirSync, readFileSync } from 'fs';
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
});
