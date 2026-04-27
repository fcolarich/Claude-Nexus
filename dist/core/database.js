import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
const NEXUS_DIR = join(homedir(), '.claude-nexus');
const DB_PATH = join(NEXUS_DIR, 'nexus.db');
export function getDbPath() {
    return DB_PATH;
}
export function openDatabase(dbPath) {
    const path = dbPath ?? DB_PATH;
    const dir = dirname(path);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    const db = new Database(path);
    // WAL mode for concurrent reads (dashboard + MCP server)
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    return db;
}
function migrateTaskSupport(db) {
    const schemaRow = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='atoms'`).get();
    if (!schemaRow)
        return; // table doesn't exist yet (fresh DB) - CREATE TABLE already has task
    if (!schemaRow.sql.includes("'task'")) {
        // Recreate atoms table to add 'task' to CHECK constraint
        db.pragma('foreign_keys = OFF');
        try {
            db.transaction(() => {
                db.exec(`CREATE TABLE atoms_new (
          id            TEXT PRIMARY KEY,
          title         TEXT NOT NULL,
          body          TEXT NOT NULL,
          atom_type     TEXT NOT NULL CHECK(atom_type IN (
            'memory', 'agent', 'skill', 'plan', 'feedback', 'reference', 'project_note', 'architecture', 'task'
          )),
          scope         TEXT NOT NULL DEFAULT 'project' CHECK(scope IN ('global', 'shared', 'project')),
          source_path   TEXT NOT NULL,
          source_type   TEXT NOT NULL CHECK(source_type IN (
            'memory_file', 'agent_def', 'skill_def', 'plan_file', 'nexus_native'
          )),
          project       TEXT,
          tags          TEXT NOT NULL DEFAULT '[]',
          content_hash  TEXT NOT NULL,
          frontmatter   TEXT,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
          status        TEXT,
          priority      INTEGER,
          blocks        TEXT,
          blocked_by    TEXT,
          discovered_from TEXT
        )`);
                db.exec(`INSERT INTO atoms_new
          (id, title, body, atom_type, scope, source_path, source_type, project, tags, content_hash, frontmatter, created_at, updated_at)
          SELECT id, title, body, atom_type, scope, source_path, source_type, project, tags, content_hash, frontmatter, created_at, updated_at
          FROM atoms`);
                db.exec(`DROP TRIGGER IF EXISTS atoms_ai`);
                db.exec(`DROP TRIGGER IF EXISTS atoms_ad`);
                db.exec(`DROP TRIGGER IF EXISTS atoms_au`);
                db.exec(`DROP TABLE IF EXISTS atoms_fts`);
                db.exec(`DROP TABLE atoms`);
                db.exec(`ALTER TABLE atoms_new RENAME TO atoms`);
            })();
        }
        finally {
            db.pragma('foreign_keys = ON');
        }
    }
    else {
        // Table has 'task' already — just add new columns if missing
        try {
            db.exec(`ALTER TABLE atoms ADD COLUMN status TEXT`);
        }
        catch { }
        try {
            db.exec(`ALTER TABLE atoms ADD COLUMN priority INTEGER`);
        }
        catch { }
        try {
            db.exec(`ALTER TABLE atoms ADD COLUMN blocks TEXT`);
        }
        catch { }
        try {
            db.exec(`ALTER TABLE atoms ADD COLUMN blocked_by TEXT`);
        }
        catch { }
        try {
            db.exec(`ALTER TABLE atoms ADD COLUMN discovered_from TEXT`);
        }
        catch { }
    }
}
function migrateCoworkSupport(db) {
    try {
        db.exec(`ALTER TABLE sessions ADD COLUMN is_cowork INTEGER DEFAULT 0`);
    }
    catch { }
    try {
        db.exec(`ALTER TABLE sessions ADD COLUMN workspace_id TEXT`);
    }
    catch { }
    try {
        db.exec(`ALTER TABLE sessions ADD COLUMN participant_id TEXT`);
    }
    catch { }
}
export function initializeSchema(db) {
    db.exec(`
    -- Atoms: single units of knowledge
    CREATE TABLE IF NOT EXISTS atoms (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      body          TEXT NOT NULL,
      atom_type     TEXT NOT NULL CHECK(atom_type IN (
        'memory', 'agent', 'skill', 'plan', 'feedback', 'reference', 'project_note', 'architecture', 'task'
      )),
      scope         TEXT NOT NULL DEFAULT 'project' CHECK(scope IN ('global', 'shared', 'project')),
      source_path   TEXT NOT NULL,
      source_type   TEXT NOT NULL CHECK(source_type IN (
        'memory_file', 'agent_def', 'skill_def', 'plan_file', 'nexus_native'
      )),
      project       TEXT,
      tags          TEXT NOT NULL DEFAULT '[]',
      content_hash  TEXT NOT NULL,
      frontmatter   TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      status        TEXT,
      priority      INTEGER,
      blocks        TEXT,
      blocked_by    TEXT,
      discovered_from TEXT
    );

    -- Semantic links between atoms
    CREATE TABLE IF NOT EXISTS atom_links (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id   TEXT NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
      target_id   TEXT NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
      link_type   TEXT NOT NULL CHECK(link_type IN (
        'references', 'extends', 'refines', 'contradicts', 'supports', 'duplicates', 'related'
      )),
      confidence  REAL NOT NULL DEFAULT 1.0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_id, target_id, link_type)
    );

    -- Sessions from JSONL files
    CREATE TABLE IF NOT EXISTS sessions (
      session_id      TEXT PRIMARY KEY,
      project         TEXT NOT NULL,
      git_branch      TEXT,
      slug            TEXT,
      jsonl_path      TEXT NOT NULL,
      started_at      TEXT,
      last_active     TEXT,
      status          TEXT NOT NULL DEFAULT 'dead' CHECK(status IN (
        'active', 'waiting_input', 'processing', 'idle', 'dead'
      )),
      input_tokens    INTEGER DEFAULT 0,
      output_tokens   INTEGER DEFAULT 0,
      estimated_cost  REAL DEFAULT 0.0,
      subagent_count  INTEGER DEFAULT 0,
      summary         TEXT,
      message_count   INTEGER DEFAULT 0,
      title           TEXT,
      custom_title    TEXT
    );

    -- Diagnostics for health checks
    CREATE TABLE IF NOT EXISTS diagnostics (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL CHECK(type IN ('broken_reference', 'missing_frontmatter', 'duplicate', 'orphan', 'stale')),
      atom_id     TEXT REFERENCES atoms(id) ON DELETE CASCADE,
      source_path TEXT,
      message     TEXT NOT NULL,
      details     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- FTS5 full-text search index
    CREATE VIRTUAL TABLE IF NOT EXISTS atoms_fts USING fts5(
      title,
      body,
      tags,
      content='atoms',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );

    -- Triggers to keep FTS5 in sync with atoms table
    -- Uses new.rowid/old.rowid which is the implicit integer rowid,
    -- matching the content_rowid='rowid' declaration above.
    CREATE TRIGGER IF NOT EXISTS atoms_ai AFTER INSERT ON atoms BEGIN
      INSERT INTO atoms_fts(rowid, title, body, tags)
      VALUES (new.rowid, new.title, new.body, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS atoms_ad AFTER DELETE ON atoms BEGIN
      INSERT INTO atoms_fts(atoms_fts, rowid, title, body, tags)
      VALUES ('delete', old.rowid, old.title, old.body, old.tags);
    END;

    -- For UPDATE: the upsert (INSERT ... ON CONFLICT DO UPDATE) keeps the
    -- same rowid, so old.rowid == new.rowid. Delete old FTS entry, insert new.
    CREATE TRIGGER IF NOT EXISTS atoms_au AFTER UPDATE ON atoms BEGIN
      INSERT INTO atoms_fts(atoms_fts, rowid, title, body, tags)
      VALUES ('delete', old.rowid, old.title, old.body, old.tags);
      INSERT INTO atoms_fts(rowid, title, body, tags)
      VALUES (new.rowid, new.title, new.body, new.tags);
    END;

    -- Migrate: add title columns if missing (for existing DBs)
    -- SQLite ignores ALTER TABLE if column already exists via this pattern
  `);
    // Safe migration for existing databases
    try {
        db.exec(`ALTER TABLE sessions ADD COLUMN title TEXT`);
    }
    catch { }
    try {
        db.exec(`ALTER TABLE sessions ADD COLUMN custom_title TEXT`);
    }
    catch { }
    // Migration: add 'task' atom_type support and task-specific columns
    migrateTaskSupport(db);
    // Migration: add Cowork session columns
    migrateCoworkSupport(db);
    // Rebuild FTS5 index to fix any stale entries from prior versions
    try {
        db.exec(`INSERT INTO atoms_fts(atoms_fts) VALUES('rebuild')`);
    }
    catch { }
    db.exec(`
    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_atoms_project ON atoms(project);
    CREATE INDEX IF NOT EXISTS idx_atoms_type ON atoms(atom_type);
    CREATE INDEX IF NOT EXISTS idx_atoms_scope ON atoms(scope);
    CREATE INDEX IF NOT EXISTS idx_atoms_source ON atoms(source_path);
    CREATE INDEX IF NOT EXISTS idx_atoms_hash ON atoms(content_hash);
    CREATE INDEX IF NOT EXISTS idx_links_source ON atom_links(source_id);
    CREATE INDEX IF NOT EXISTS idx_links_target ON atom_links(target_id);
    CREATE INDEX IF NOT EXISTS idx_links_type ON atom_links(link_type);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_diagnostics_type ON diagnostics(type);
  `);
}
//# sourceMappingURL=database.js.map