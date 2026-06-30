import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { insertMemory, type MemoryInput } from './memories.js';
import { recallMemories, recallByQuery } from './recall.js';

function freshDb() {
  const db = openDatabase(':memory:');
  initializeSchema(db);
  return db;
}

const base: Omit<MemoryInput, 'title' | 'body'> = {
  memory_type: 'convention',
  scope: 'project',
  project: 'projA',
  confidence: 0.8,
  decay_class: 'stable',
  review_status: 'approved',
  source_session_id: null,
  discovered_from: null,
  tags: [],
};
const add = (db: ReturnType<typeof freshDb>, o: Partial<MemoryInput> & { title: string; body: string }) =>
  insertMemory(db, { ...base, ...o });

describe('recallMemories', () => {
  it('ranks by score (confidence) descending', () => {
    const db = freshDb();
    add(db, { title: 'Low', body: 'low conf body', confidence: 0.5 });
    add(db, { title: 'High', body: 'high conf body', confidence: 0.95 });
    add(db, { title: 'Mid', body: 'mid conf body', confidence: 0.7 });
    const r = recallMemories(db, { project: 'projA' });
    expect(r.items.map(i => i.memory.title)).toEqual(['High', 'Mid', 'Low']);
    db.close();
  });

  it('degrades to titles-only when the budget is exceeded', () => {
    const db = freshDb();
    const big = 'x'.repeat(400);
    for (let i = 0; i < 6; i++) add(db, { title: `Mem ${i}`, body: `${i} ${big}`, confidence: 0.9 - i * 0.05 });
    const r = recallMemories(db, { project: 'projA', maxTokens: 250 });

    expect(r.total).toBe(6);
    expect(r.items.filter(i => i.mode === 'full').length).toBeGreaterThan(0);
    expect(r.items.filter(i => i.mode === 'title').length).toBeGreaterThan(0);
    const firstTitle = r.items.findIndex(i => i.mode === 'title');
    expect(r.items.slice(firstTitle).every(i => i.mode === 'title')).toBe(true);
    db.close();
  });

  it('recalls project + global, excludes other projects', () => {
    const db = freshDb();
    add(db, { title: 'A mem', body: 'belongs to A', project: 'projA' });
    add(db, { title: 'B mem', body: 'belongs to B', project: 'projB' });
    add(db, { title: 'Global mem', body: 'a global one', scope: 'global', project: null });
    const titles = recallMemories(db, { project: 'projA' }).items.map(i => i.memory.title);
    expect(titles).toContain('A mem');
    expect(titles).toContain('Global mem');
    expect(titles).not.toContain('B mem');
    db.close();
  });

  it('pins load_at_init memories first regardless of score', () => {
    const db = freshDb();
    add(db, { title: 'High score', body: 'high one', confidence: 0.95 });
    add(db, { title: 'Pinned', body: 'pinned low conf', confidence: 0.4, load_at_init: true });
    const r = recallMemories(db, { project: 'projA' });
    expect(r.items[0].memory.title).toBe('Pinned');
    db.close();
  });

  it('recalls only approved memories', () => {
    const db = freshDb();
    add(db, { title: 'Approved', body: 'approved body', review_status: 'approved' });
    add(db, { title: 'Pending', body: 'pending body', review_status: 'pending' });
    add(db, { title: 'Rejected', body: 'rejected body', review_status: 'rejected' });
    expect(recallMemories(db, { project: 'projA' }).items.map(i => i.memory.title)).toEqual(['Approved']);
    db.close();
  });

  it('excludes sub-threshold confidence unless load_at_init', () => {
    const db = freshDb();
    add(db, { title: 'TooLow', body: 'too low conf', confidence: 0.2 });
    add(db, { title: 'LowButPinned', body: 'low but pinned', confidence: 0.2, load_at_init: true });
    const titles = recallMemories(db, { project: 'projA' }).items.map(i => i.memory.title);
    expect(titles).not.toContain('TooLow');
    expect(titles).toContain('LowButPinned');
    db.close();
  });

  it('returns empty when there are no memories', () => {
    const db = freshDb();
    const r = recallMemories(db, { project: 'projA' });
    expect(r.items).toHaveLength(0);
    expect(r.markdown).toBe('');
    db.close();
  });

  it('restricts to FTS matches when a query is given', () => {
    const db = freshDb();
    add(db, { title: 'Tabs rule', body: 'always use tabs for indentation' });
    add(db, { title: 'Async rule', body: 'prefer async await over promises' });
    const r = recallMemories(db, { project: 'projA', query: 'tabs' });
    expect(r.items.map(i => i.memory.title)).toEqual(['Tabs rule']);
    db.close();
  });
});

describe('recallByQuery', () => {
  // Offline/CI has no Ollama, so generateEmbedding returns null and recallByQuery
  // uses its FTS5 fallback — these assertions hold on the fallback path.
  it('returns query-matching memories, dual-bank scope', async () => {
    const db = freshDb();
    add(db, { title: 'Tabs rule', body: 'always use tabs for indentation', project: 'projA' });
    add(db, { title: 'Other proj', body: 'tabs but wrong project', project: 'projB' });
    add(db, { title: 'Global tabs', body: 'global tabs note', scope: 'global', project: null });
    const r = await recallByQuery(db, { project: 'projA', query: 'tabs' });
    const titles = r.items.map(i => i.memory.title);
    expect(titles).toContain('Tabs rule');
    expect(titles).toContain('Global tabs');
    expect(titles).not.toContain('Other proj');
    db.close();
  });

  it('excludes memories in excludeIds (session dedup)', async () => {
    const db = freshDb();
    const m = add(db, { title: 'Tabs rule', body: 'always use tabs for indentation' });
    const r = await recallByQuery(db, { project: 'projA', query: 'tabs', excludeIds: [m.id] });
    expect(r.items.map(i => i.memory.title)).not.toContain('Tabs rule');
    db.close();
  });

  it('returns empty for a query that matches nothing', async () => {
    const db = freshDb();
    add(db, { title: 'Tabs rule', body: 'always use tabs for indentation' });
    const r = await recallByQuery(db, { project: 'projA', query: 'kubernetes networking' });
    expect(r.items).toHaveLength(0);
    expect(r.markdown).toBe('');
    db.close();
  });
});
