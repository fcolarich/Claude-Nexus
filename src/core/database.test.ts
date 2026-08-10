import { describe, it, expect } from 'vitest';
import type DatabaseType from 'better-sqlite3';
import { openDatabase, initializeSchema, LATEST_SCHEMA_VERSION } from './database.js';

function schemaVersion(db: DatabaseType.Database): number {
  const row = db.prepare(`SELECT MAX(version) AS v FROM schema_version`).get() as { v: number | null };
  return row?.v ?? 0;
}

function tableExists(db: DatabaseType.Database, name: string): boolean {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

function columnExists(db: DatabaseType.Database, table: string, col: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === col);
}

describe('schema migrations', () => {
  it('brings a fresh DB to the latest version', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);

    expect(schemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(tableExists(db, 'atoms')).toBe(true);
    expect(tableExists(db, 'memories')).toBe(true);
    expect(tableExists(db, 'memory_links')).toBe(true);
    expect(tableExists(db, 'memories_fts')).toBe(true);
    expect(columnExists(db, 'sessions', 'last_reflected_index')).toBe(true);
    expect(columnExists(db, 'memories', 'identifiers')).toBe(true);
    expect(tableExists(db, 'claims')).toBe(true);
    db.close();
  });

  it('migration v13: claims table has the design-doc schema', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);

    for (const col of [
      'id', 'memory_id', 'source_memory_id', 'fact', 'claim_type', 'identifiers',
      'confidence', 'valid_from', 'valid_until', 'recorded_at', 'expired_at', 'created_at',
    ]) {
      expect(columnExists(db, 'claims', col)).toBe(true);
    }
    db.close();
  });

  it('migration v15: memories.claims_extracted_at cursor column exists', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    expect(columnExists(db, 'memories', 'claims_extracted_at')).toBe(true);
    db.close();
  });

  it('migration v14: claims_vec table exists for the dedup cascade only', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    expect(tableExists(db, 'claims_vec')).toBe(true);
    db.close();
  });

  it('migration v13: memory_links accepts same_as and supersedes link types', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);

    expect(() => db.prepare(
      `INSERT INTO memory_links (source_id, target_id, link_type, confidence) VALUES ('a', 'b', 'same_as', 0.9)`
    ).run()).not.toThrow();
    expect(() => db.prepare(
      `INSERT INTO memory_links (source_id, target_id, link_type, confidence) VALUES ('a', 'c', 'supersedes', 1.0)`
    ).run()).not.toThrow();
    // Existing link types must still work after the CHECK-constraint recreate.
    expect(() => db.prepare(
      `INSERT INTO memory_links (source_id, target_id, link_type, confidence) VALUES ('a', 'd', 'contradicts', 1.0)`
    ).run()).not.toThrow();
    db.close();
  });

  it('migration 6: sessions.cwd column exists', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    expect(columnExists(db, 'sessions', 'cwd')).toBe(true);
    db.close();
  });

  it('migration 6: atoms.linked_at column exists', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    expect(columnExists(db, 'atoms', 'linked_at')).toBe(true);
    db.close();
  });

  it('migration 6: memories.linked_at column exists', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    expect(columnExists(db, 'memories', 'linked_at')).toBe(true);
    db.close();
  });

  it("migration 6: source_type='project_doc' atom inserts without CHECK violation", () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    expect(() => {
      db.prepare(`
        INSERT INTO atoms (id, title, body, atom_type, scope, source_path, source_type, content_hash)
        VALUES ('pd1', 'Test Doc', 'body', 'project_note', 'project', '/test/doc.md', 'project_doc', 'abc')
      `).run();
    }).not.toThrow();
    db.close();
  });

  it("migration 6: source_type='invalid_type' throws CHECK violation", () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    expect(() => {
      db.prepare(`
        INSERT INTO atoms (id, title, body, atom_type, scope, source_path, source_type, content_hash)
        VALUES ('bad1', 'Bad', 'body', 'project_note', 'project', '/test/bad.md', 'invalid_type', 'xyz')
      `).run();
    }).toThrow();
    db.close();
  });

  it('is idempotent — re-init applies no migration twice', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    const afterFirst = (db.prepare(`SELECT COUNT(*) AS c FROM schema_version`).get() as { c: number }).c;
    initializeSchema(db);
    const afterSecond = (db.prepare(`SELECT COUNT(*) AS c FROM schema_version`).get() as { c: number }).c;

    expect(afterSecond).toBe(afterFirst);
    expect(schemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });

  it('imports legacy memory atoms into the memories table', () => {
    const db = openDatabase(':memory:');

    // Simulate a pre-versioning v1 DB: atoms populated, no schema_version table
    db.exec(`CREATE TABLE atoms (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      body          TEXT NOT NULL,
      atom_type     TEXT NOT NULL CHECK(atom_type IN (
        'memory','agent','skill','plan','feedback','reference','project_note','architecture','task')),
      scope         TEXT NOT NULL DEFAULT 'project',
      source_path   TEXT NOT NULL,
      source_type   TEXT NOT NULL,
      project       TEXT,
      tags          TEXT NOT NULL DEFAULT '[]',
      content_hash  TEXT NOT NULL,
      frontmatter   TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const insert = db.prepare(
      `INSERT INTO atoms (id, title, body, atom_type, scope, source_path, source_type, project, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run('m1', 'Pref', 'body', 'memory', 'global', '/p/m.md', 'memory_file', 'proj', 'h1');
    insert.run('f1', 'Fix', 'body', 'feedback', 'project', '/p/f.md', 'memory_file', 'proj', 'h2');
    insert.run('a1', 'Arch', 'body', 'architecture', 'project', '/p/a.md', 'memory_file', 'proj', 'h3');
    insert.run('s1', 'Skill', 'body', 'skill', 'global', '/p/s.md', 'skill_def', null, 'h4');

    initializeSchema(db);

    expect(schemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);

    const mems = db.prepare(
      `SELECT id, memory_type, decay_class, review_status, confidence FROM memories ORDER BY id`
    ).all() as { id: string; memory_type: string; decay_class: string; review_status: string; confidence: number }[];

    expect(mems.length).toBe(3); // the skill atom is not a memory — not imported
    const byId = Object.fromEntries(mems.map((m) => [m.id, m]));
    expect(byId.m1.memory_type).toBe('insight');
    expect(byId.f1.memory_type).toBe('correction');
    expect(byId.a1.memory_type).toBe('decision');
    expect(byId.a1.decay_class).toBe('architecture');
    expect(byId.f1.decay_class).toBe('implementation');
    expect(byId.m1.review_status).toBe('approved');
    expect(byId.m1.confidence).toBe(0.6);

    // Legacy atoms remain in place — the indexer cut happens in a later phase
    expect((db.prepare(`SELECT COUNT(*) AS c FROM atoms`).get() as { c: number }).c).toBe(4);
    db.close();
  });

  it('migration v9: promotion_target and promoted_to columns exist after initializeSchema', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    expect(columnExists(db, 'memories', 'promotion_target')).toBe(true);
    expect(columnExists(db, 'memories', 'promoted_to')).toBe(true);
    expect(schemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });

  it('migration v9: partial index idx_memories_promotion exists', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memories_promotion'`).get();
    expect(idx).toBeTruthy();
    db.close();
  });

  it('migration v9: promotion_target defaults to "none" for rows inserted without specifying it', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    db.prepare(`
      INSERT INTO memories (id, title, body, memory_type, content_hash)
      VALUES ('test-promo-default', 'Test', 'body', 'insight', 'hash-promo')
    `).run();
    const row = db.prepare(`SELECT promotion_target FROM memories WHERE id = 'test-promo-default'`).get() as { promotion_target: string };
    expect(row.promotion_target).toBe('none');
    db.close();
  });

  it('migration v9: promotion_target CHECK rejects invalid values', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    expect(() => {
      db.prepare(`
        INSERT INTO memories (id, title, body, memory_type, content_hash, promotion_target)
        VALUES ('bad-promo', 'Bad', 'body', 'insight', 'hash-bad', 'invalid_target')
      `).run();
    }).toThrow();
    db.close();
  });

  it('migration v9: re-running initializeSchema is idempotent (schema_version row count unchanged)', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    const afterFirst = (db.prepare(`SELECT COUNT(*) AS c FROM schema_version`).get() as { c: number }).c;
    initializeSchema(db);
    const afterSecond = (db.prepare(`SELECT COUNT(*) AS c FROM schema_version`).get() as { c: number }).c;
    expect(afterSecond).toBe(afterFirst);
    expect(schemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });

  it('migration v10: vcc_shrunk_at column exists after initializeSchema', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    expect(columnExists(db, 'sessions', 'vcc_shrunk_at')).toBe(true);
    expect(schemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });

  it('migration v10: running initializeSchema twice is idempotent (no throw, column queryable)', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    expect(() => initializeSchema(db)).not.toThrow();
    expect(columnExists(db, 'sessions', 'vcc_shrunk_at')).toBe(true);
    const row = db.prepare(`SELECT vcc_shrunk_at FROM sessions LIMIT 0`).all();
    expect(row).toEqual([]);
    db.close();
  });

  it('migration v11: distilled_at column + index exist and default to NULL', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    expect(columnExists(db, 'memories', 'distilled_at')).toBe(true);

    db.prepare(`
      INSERT INTO memories (id, title, body, memory_type, content_hash)
      VALUES ('test-distill-cursor', 'Test', 'body', 'insight', 'hash-distill')
    `).run();
    const row = db.prepare(`SELECT distilled_at FROM memories WHERE id = 'test-distill-cursor'`).get() as { distilled_at: string | null };
    expect(row.distilled_at).toBeNull();

    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memories_distilled_at'`).get();
    expect(idx).toBeTruthy();
    expect(schemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });

  it('migration v11: running initializeSchema twice is idempotent (no throw, column queryable)', () => {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    expect(() => initializeSchema(db)).not.toThrow();
    expect(db.prepare(`SELECT distilled_at FROM memories LIMIT 0`).all()).toEqual([]);
    db.close();
  });

  it('migration v7 removes task support while preserving corpus-expansion columns', () => {
    const db = openDatabase(':memory:');

    // Seed a v6-shaped atoms table: has linked_at + project_doc + task columns,
    // and 'task' in the atom_type CHECK. No schema_version row (simulates pre-v7).
    db.exec(`CREATE TABLE atoms (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
      atom_type TEXT NOT NULL CHECK(atom_type IN (
        'memory','agent','skill','plan','feedback','reference','project_note','architecture','task')),
      scope TEXT NOT NULL DEFAULT 'project',
      source_path TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN (
        'memory_file','agent_def','skill_def','plan_file','nexus_native','project_doc')),
      project TEXT, tags TEXT NOT NULL DEFAULT '[]', content_hash TEXT NOT NULL,
      frontmatter TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      linked_at TEXT, status TEXT, priority INTEGER, blocks TEXT, blocked_by TEXT,
      discovered_from TEXT, load_at_init INTEGER NOT NULL DEFAULT 0
    )`);
    const insert = db.prepare(
      `INSERT INTO atoms (id, title, body, atom_type, scope, source_path, source_type, project, content_hash, linked_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run('mem1', 'A memory', 'body', 'memory', 'project', '/p/m.md', 'memory_file', 'proj', 'h1', '2025-01-02T03:04:05Z', null);
    insert.run('doc1', 'A doc', 'body', 'reference', 'project', '/p/d.md', 'project_doc', 'proj', 'h2', null, null);
    insert.run('task1', 'A task', 'body', 'task', 'project', '/p/t.md', 'nexus_native', 'proj', 'h3', null, 'ready');

    initializeSchema(db);

    const cols = (db.prepare(`PRAGMA table_info(atoms)`).all() as { name: string }[]).map(c => c.name);
    // Task columns gone
    for (const taskCol of ['status', 'priority', 'blocks', 'blocked_by', 'discovered_from']) {
      expect(cols).not.toContain(taskCol);
    }
    // Corpus-expansion column preserved
    expect(cols).toContain('linked_at');

    // Task rows purged; non-task rows kept
    const taskCount = (db.prepare(`SELECT COUNT(*) AS c FROM atoms WHERE atom_type = 'task'`).get() as { c: number }).c;
    expect(taskCount).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM atoms WHERE id = 'mem1'`).get() as { c: number }).c).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM atoms WHERE id = 'doc1'`).get() as { c: number }).c).toBe(1);

    // linked_at value survived the rebuild
    const linkedAt = (db.prepare(`SELECT linked_at AS v FROM atoms WHERE id = 'mem1'`).get() as { v: string | null }).v;
    expect(linkedAt).toBe('2025-01-02T03:04:05Z');

    // project_doc still accepted by the CHECK after v7
    expect(() => db.prepare(
      `INSERT INTO atoms (id, title, body, atom_type, scope, source_path, source_type, content_hash)
       VALUES ('doc2','New doc','b','reference','project','/p/d2.md','project_doc','h4')`
    ).run()).not.toThrow();

    // idx_atoms_linked recreated
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_atoms_linked'`).get();
    expect(idx).toBeTruthy();

    // Schema fully migrated
    expect(schemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);

    db.close();
  });
});
