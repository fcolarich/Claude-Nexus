import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema, LATEST_SCHEMA_VERSION } from './database.js';
function schemaVersion(db) {
    const row = db.prepare(`SELECT MAX(version) AS v FROM schema_version`).get();
    return row?.v ?? 0;
}
function tableExists(db, name) {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}
function columnExists(db, table, col) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
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
        const afterFirst = db.prepare(`SELECT COUNT(*) AS c FROM schema_version`).get().c;
        initializeSchema(db);
        const afterSecond = db.prepare(`SELECT COUNT(*) AS c FROM schema_version`).get().c;
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
        const insert = db.prepare(`INSERT INTO atoms (id, title, body, atom_type, scope, source_path, source_type, project, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        insert.run('m1', 'Pref', 'body', 'memory', 'global', '/p/m.md', 'memory_file', 'proj', 'h1');
        insert.run('f1', 'Fix', 'body', 'feedback', 'project', '/p/f.md', 'memory_file', 'proj', 'h2');
        insert.run('a1', 'Arch', 'body', 'architecture', 'project', '/p/a.md', 'memory_file', 'proj', 'h3');
        insert.run('s1', 'Skill', 'body', 'skill', 'global', '/p/s.md', 'skill_def', null, 'h4');
        initializeSchema(db);
        expect(schemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
        const mems = db.prepare(`SELECT id, memory_type, decay_class, review_status, confidence FROM memories ORDER BY id`).all();
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
        expect(db.prepare(`SELECT COUNT(*) AS c FROM atoms`).get().c).toBe(4);
        db.close();
    });
});
//# sourceMappingURL=database.test.js.map