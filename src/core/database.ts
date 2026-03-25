import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

const NEXUS_DIR = join(homedir(), '.claude-nexus');
const DB_PATH = join(NEXUS_DIR, 'nexus.db');

export function getDbPath(): string {
  return DB_PATH;
}

export function openDatabase(dbPath?: string): Database.Database {
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

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    -- Atoms: single units of knowledge
    CREATE TABLE IF NOT EXISTS atoms (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      body          TEXT NOT NULL,
      atom_type     TEXT NOT NULL CHECK(atom_type IN (
        'memory', 'agent', 'skill', 'plan', 'feedback', 'reference', 'project_note', 'architecture'
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
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
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
      message_count   INTEGER DEFAULT 0
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
    CREATE TRIGGER IF NOT EXISTS atoms_ai AFTER INSERT ON atoms BEGIN
      INSERT INTO atoms_fts(rowid, title, body, tags)
      VALUES (new.rowid, new.title, new.body, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS atoms_ad AFTER DELETE ON atoms BEGIN
      INSERT INTO atoms_fts(atoms_fts, rowid, title, body, tags)
      VALUES ('delete', old.rowid, old.title, old.body, old.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS atoms_au AFTER UPDATE ON atoms BEGIN
      INSERT INTO atoms_fts(atoms_fts, rowid, title, body, tags)
      VALUES ('delete', old.rowid, old.title, old.body, old.tags);
      INSERT INTO atoms_fts(rowid, title, body, tags)
      VALUES (new.rowid, new.title, new.body, new.tags);
    END;

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
