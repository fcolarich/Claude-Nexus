/**
 * Unit tests for src/core/links.ts — rrfMerge, upsertLink, linkAtom, buildBm25Corpus.
 * Uses in-memory SQLite; no real embedding server calls.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type DatabaseType from 'better-sqlite3';
import { openDatabase, initializeSchema } from './database.js';
import {
  buildBm25Corpus,
  rrfMerge,
  upsertLink,
  linkAtom,
} from './links.js';
import { vecToBlob, normalize } from './memories.js';
import type { RankedResult } from './links.js';

// ── Helpers ───────────────────────────────────────────────────────────

function freshDb(): DatabaseType.Database {
  const db = openDatabase(':memory:');
  initializeSchema(db);
  return db;
}

/** Deterministic embedding: same text → same unit-normalized vector. */
function fakeEmbed(text: string): Float32Array {
  const v = new Float32Array(1024);
  let seed = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) seed = ((seed ^ text.charCodeAt(i)) * 16777619) >>> 0;
  for (let i = 0; i < 1024; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; v[i] = seed / 0xffffffff - 0.5; }
  return normalize(v);
}

async function embedFn(text: string): Promise<Float32Array | null> {
  return fakeEmbed(text);
}

/** Insert a minimal atom and optionally store its vector in atoms_vec. */
function insertAtom(
  db: DatabaseType.Database,
  id: string,
  title: string,
  body: string,
  opts: { withVec?: boolean; linkedAt?: string | null } = {}
): void {
  db.prepare(`
    INSERT OR IGNORE INTO atoms
      (id, title, body, atom_type, scope, source_path, source_type, content_hash, linked_at)
    VALUES
      (?, ?, ?, 'project_note', 'project', '/test/' || ?, 'project_doc', ?, ?)
  `).run(id, title, body, id, id + body, opts.linkedAt ?? null);

  if (opts.withVec) {
    const vec = fakeEmbed(`${title}\n${body}`);
    const row = db.prepare(`SELECT rowid FROM atoms WHERE id = ?`).get(id) as { rowid: number };
    try {
      db.prepare(`INSERT OR IGNORE INTO atoms_vec(rowid, embedding) VALUES (${row.rowid}, ?)`).run(vecToBlob(vec));
    } catch { /* atoms_vec not loaded */ }
  }
}

// ── rrfMerge tests ────────────────────────────────────────────────────

describe('rrfMerge', () => {
  it('item in both lists ranks above item in only one list', () => {
    const bm25: RankedResult[] = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.5 },
    ];
    const dense: RankedResult[] = [
      { id: 'a', score: 0.8 },
      { id: 'c', score: 0.7 },
    ];
    const merged = rrfMerge(bm25, dense, 10);
    const ids = merged.map(r => r.id);
    // 'a' appears in both → higher RRF score than 'b' or 'c'
    expect(ids[0]).toBe('a');
  });

  it('empty dense list returns BM25 results', () => {
    const bm25: RankedResult[] = [
      { id: 'x', score: 1.0 },
      { id: 'y', score: 0.5 },
    ];
    const merged = rrfMerge(bm25, [], 10);
    expect(merged.map(r => r.id)).toEqual(['x', 'y']);
  });

  it('empty BM25 list returns dense results', () => {
    const dense: RankedResult[] = [
      { id: 'p', score: 0.9 },
      { id: 'q', score: 0.4 },
    ];
    const merged = rrfMerge([], dense, 10);
    expect(merged.map(r => r.id)).toEqual(['p', 'q']);
  });

  it('returns no more than topK items', () => {
    const bm25: RankedResult[] = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, score: 1 - i * 0.05 }));
    const dense: RankedResult[] = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, score: 1 - i * 0.05 }));
    const merged = rrfMerge(bm25, dense, 5);
    expect(merged.length).toBeLessThanOrEqual(5);
  });

  it('both lists empty returns empty array', () => {
    expect(rrfMerge([], [], 10)).toEqual([]);
  });
});

// ── upsertLink tests ──────────────────────────────────────────────────

describe('upsertLink', () => {
  it('inserts two rows (A→B and B→A) per call', () => {
    const db = freshDb();
    insertAtom(db, 'a', 'Atom A', 'body a');
    insertAtom(db, 'b', 'Atom B', 'body b');

    upsertLink(db, 'a', 'b', 'related', 0.8);

    const rows = db.prepare(`SELECT source_id, target_id FROM atom_links WHERE link_type='related'`).all() as { source_id: string; target_id: string }[];
    expect(rows.length).toBe(2);
    const pairs = rows.map(r => `${r.source_id}→${r.target_id}`).sort();
    expect(pairs).toContain('a→b');
    expect(pairs).toContain('b→a');
    db.close();
  });

  it('second identical call leaves row count unchanged (idempotent)', () => {
    const db = freshDb();
    insertAtom(db, 'a', 'A', 'body');
    insertAtom(db, 'b', 'B', 'body');

    upsertLink(db, 'a', 'b', 'related', 0.8);
    const before = (db.prepare(`SELECT COUNT(*) AS c FROM atom_links`).get() as { c: number }).c;
    upsertLink(db, 'a', 'b', 'related', 0.8);
    const after = (db.prepare(`SELECT COUNT(*) AS c FROM atom_links`).get() as { c: number }).c;

    expect(after).toBe(before);
    db.close();
  });

  it('self-link (A→A) inserts zero rows', () => {
    const db = freshDb();
    insertAtom(db, 'a', 'A', 'body');

    upsertLink(db, 'a', 'a', 'related', 1.0);

    const count = (db.prepare(`SELECT COUNT(*) AS c FROM atom_links`).get() as { c: number }).c;
    expect(count).toBe(0);
    db.close();
  });
});

// ── linkAtom tests ────────────────────────────────────────────────────

describe('linkAtom', () => {
  it('atom with linked_at > updated_at writes no atom_links rows', async () => {
    const db = freshDb();
    // Set linked_at to a future-ish timestamp
    insertAtom(db, 'a', 'A', 'body', { linkedAt: '2099-01-01 00:00:00' });
    db.prepare(`UPDATE atoms SET updated_at = '2020-01-01 00:00:00' WHERE id = 'a'`).run();

    await linkAtom(db, 'a', embedFn);

    const count = (db.prepare(`SELECT COUNT(*) AS c FROM atom_links`).get() as { c: number }).c;
    expect(count).toBe(0);
    db.close();
  });

  it('never writes a self-link even when corpus contains the same atom', async () => {
    const db = freshDb();
    // Add enough atoms for BM25 corpus (needs >= 3)
    for (let i = 0; i < 5; i++) {
      insertAtom(db, `seed${i}`, `Seed ${i}`, `seed body ${i}`);
    }
    insertAtom(db, 'target', 'Target Atom', 'some unique body text');

    await linkAtom(db, 'target', embedFn);

    const selfLinks = db.prepare(
      `SELECT * FROM atom_links WHERE source_id = 'target' AND target_id = 'target'`
    ).all();
    expect(selfLinks.length).toBe(0);
    db.close();
  });

  it('updates atoms.linked_at after processing', async () => {
    const db = freshDb();
    for (let i = 0; i < 5; i++) insertAtom(db, `s${i}`, `S ${i}`, `body ${i}`);
    insertAtom(db, 'x', 'X', 'body x');

    await linkAtom(db, 'x', embedFn);

    const row = db.prepare(`SELECT linked_at FROM atoms WHERE id = 'x'`).get() as { linked_at: string | null };
    expect(row.linked_at).not.toBeNull();
    db.close();
  });
});

// ── buildBm25Corpus tests ─────────────────────────────────────────────

describe('buildBm25Corpus', () => {
  it('exact title match scores above unrelated doc', () => {
    const docs = [
      { id: '1', title: 'Claude Nexus memory engine', body: 'captures memories from sessions' },
      { id: '2', title: 'Unrelated document', body: 'something completely different about flowers' },
      { id: '3', title: 'Another unrelated topic', body: 'cooking recipes and kitchen tips' },
      // need at least 3 docs
    ];
    const corpus = buildBm25Corpus(docs);
    const results = corpus.search('Claude Nexus memory engine', 5);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0][0]).toBe('1');
  });
});
