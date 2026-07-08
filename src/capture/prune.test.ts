import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../core/database.js';
import { insertMemory, deleteMemory } from '../core/memories.js';
import { selectNarrationMemories } from './prune.js';

function seed(db: Database.Database) {
  const base = { scope: 'project' as const, project: 'p', confidence: 0.9, review_status: 'approved' as const, source_session_id: 's', discovered_from: null, tags: [] as string[], promotion_target: 'none' as const };
  insertMemory(db, { ...base, title: 'Odin soft dependency', body: 'Odin is a hard dependency only for some packages.', memory_type: 'decision', decay_class: 'architecture' });
  insertMemory(db, { ...base, title: 'Doc spine initialized', body: 'Scaffold complete for the project.', memory_type: 'handoff', decay_class: 'implementation' });
  insertMemory(db, { ...base, title: 'Vinspector knowledge extraction completed', body: 'Extracted patterns from the plugin.', memory_type: 'reference', decay_class: 'implementation' });
  insertMemory(db, { ...base, title: 'UPM package-per-tool', body: 'Uses package-per-tool. Codified in ADR-001 and DDR-001.', memory_type: 'decision', decay_class: 'architecture' });
}

describe('selectNarrationMemories', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); initializeSchema(db); seed(db); });

  it('selects only handoff memories', () => {
    const victims = selectNarrationMemories(db);
    expect(victims.map(v => v.reason)).toEqual(['handoff']);
    expect(victims).toHaveLength(1);
    expect(victims[0].title).toBe('Doc spine initialized');
  });

  it('does not select the clean Odin decision, the reference, or the ADR-citing decision', () => {
    const victims = selectNarrationMemories(db);
    expect(victims.some(v => v.title.includes('Odin'))).toBe(false);
    expect(victims.some(v => v.title.includes('knowledge extraction'))).toBe(false);
    expect(victims.some(v => v.title.includes('UPM'))).toBe(false);
  });

  it('deleteMemory removes the row', () => {
    const victims = selectNarrationMemories(db);
    for (const v of victims) expect(deleteMemory(db, v.id)).toBe(true);
    expect(selectNarrationMemories(db)).toHaveLength(0);
  });
});
