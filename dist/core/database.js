import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import * as sqliteVec from 'sqlite-vec';
const NEXUS_DIR = join(homedir(), '.claude', 'memories');
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
    db.pragma('busy_timeout = 30000');
    // Load sqlite-vec extension for vector search (non-fatal if unavailable)
    try {
        sqliteVec.load(db);
    }
    catch (err) {
        console.warn('[claude-nexus] sqlite-vec failed to load — vector search disabled:', err.message);
    }
    return db;
}
const MIGRATIONS = [
    { version: 1, name: 'baseline-v1-schema', up: migrateBaseline },
    { version: 2, name: 'memories-tables', up: migrateMemories },
    { version: 3, name: 'session-reflection-cursor', up: migrateReflectionCursor },
    { version: 4, name: 'import-legacy-memory-atoms', up: migrateImportLegacyMemories },
    { version: 5, name: 'session-messages-fts', up: migrateSessionMessagesFts },
    { version: 6, name: 'corpus-expansion', up: migrateCorpusExpansion },
    { version: 7, name: 'remove-task-support', up: migrateRemoveTaskSupport },
    { version: 8, name: 'project-aliases', up: migrateProjectAliases },
    { version: 9, name: 'promotion-classification', up: migratePromotionClassification },
    { version: 10, name: 'vcc-shrunk-at', up: migrateVccShrunkAt },
    { version: 11, name: 'distill-cursor', up: migrateDistillCursor },
];
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
function getSchemaVersion(db) {
    const row = db.prepare(`SELECT MAX(version) AS v FROM schema_version`).get();
    return row?.v ?? 0;
}
export function initializeSchema(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
    const current = getSchemaVersion(db);
    const record = db.prepare(`INSERT INTO schema_version (version, name) VALUES (?, ?)`);
    for (const m of MIGRATIONS) {
        if (m.version <= current)
            continue;
        m.up(db);
        record.run(m.version, m.name);
    }
}
// ── Migration 1: baseline v1 schema ──────────────────────────────────
// Builds the v1 schema on a fresh DB; brings a pre-versioning DB current.
// Every statement is idempotent.
function migrateBaseline(db) {
    db.exec(`
    -- Atoms: file-indexed knowledge artifacts (agents, skills, plans, tasks, notes)
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
      discovered_from TEXT,
      load_at_init  INTEGER NOT NULL DEFAULT 0
    );

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

    CREATE TABLE IF NOT EXISTS diagnostics (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL CHECK(type IN ('broken_reference', 'missing_frontmatter', 'duplicate', 'orphan', 'stale')),
      atom_id     TEXT REFERENCES atoms(id) ON DELETE CASCADE,
      source_path TEXT,
      message     TEXT NOT NULL,
      details     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS atoms_fts USING fts5(
      title, body, tags,
      content='atoms',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );

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
  `);
    // Vector search table — created separately because vec0 may not be loaded
    try {
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS atoms_vec USING vec0(embedding float[1024])`);
        db.exec(`
      CREATE TRIGGER IF NOT EXISTS atoms_vec_ad AFTER DELETE ON atoms BEGIN
        DELETE FROM atoms_vec WHERE rowid = old.rowid;
      END;
    `);
    }
    catch (err) {
        console.warn('[claude-nexus] Could not create atoms_vec table — vector search disabled:', err.message);
    }
    // Bring pre-versioning databases current (all guarded / idempotent)
    try {
        db.exec(`ALTER TABLE sessions ADD COLUMN title TEXT`);
    }
    catch { }
    try {
        db.exec(`ALTER TABLE sessions ADD COLUMN custom_title TEXT`);
    }
    catch { }
    migrateTaskSupport(db);
    migrateCoworkSupport(db);
    migrateLoadAtInit(db);
    // One-time FTS rebuild to clear any stale entries from prior versions.
    // Triggers keep it in sync afterwards, so this no longer runs every startup.
    try {
        db.exec(`INSERT INTO atoms_fts(atoms_fts) VALUES('rebuild')`);
    }
    catch { }
    db.exec(`
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
function migrateTaskSupport(db) {
    const schemaRow = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='atoms'`).get();
    if (!schemaRow)
        return;
    if (!schemaRow.sql.includes("'task'")) {
        // Recreate atoms table to add 'task' to the CHECK constraint
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
// ── Migration 7: remove task support ─────────────────────────────────
// Drops the five task columns (status, priority, blocks, blocked_by,
// discovered_from) from atoms, removes 'task' from the atom_type CHECK, and
// purges task rows. Append-only: earlier migrations that added task support are
// left intact; this converges fresh and existing DBs to the task-free shape.
function migrateRemoveTaskSupport(db) {
    const schemaRow = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='atoms'`).get();
    if (!schemaRow)
        return;
    // Idempotent: if already task-free, nothing to do.
    if (!schemaRow.sql.includes("'task'") && !schemaRow.sql.includes('blocked_by'))
        return;
    db.pragma('foreign_keys = OFF');
    try {
        db.transaction(() => {
            db.exec(`CREATE TABLE atoms_new (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        body          TEXT NOT NULL,
        atom_type     TEXT NOT NULL CHECK(atom_type IN (
          'memory', 'agent', 'skill', 'plan', 'feedback', 'reference', 'project_note', 'architecture'
        )),
        scope         TEXT NOT NULL DEFAULT 'project' CHECK(scope IN ('global', 'shared', 'project')),
        source_path   TEXT NOT NULL,
        source_type   TEXT NOT NULL CHECK(source_type IN (
          'memory_file', 'agent_def', 'skill_def', 'plan_file', 'nexus_native', 'project_doc'
        )),
        project       TEXT,
        tags          TEXT NOT NULL DEFAULT '[]',
        content_hash  TEXT NOT NULL,
        frontmatter   TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
        linked_at     TEXT,
        load_at_init  INTEGER NOT NULL DEFAULT 0
      )`);
            // Copy every non-task atom; task rows are purged by exclusion.
            db.exec(`INSERT INTO atoms_new
        (id, title, body, atom_type, scope, source_path, source_type, project, tags, content_hash, frontmatter, created_at, updated_at, linked_at, load_at_init)
        SELECT id, title, body, atom_type, scope, source_path, source_type, project, tags, content_hash, frontmatter, created_at, updated_at, linked_at, load_at_init
        FROM atoms WHERE atom_type != 'task'`);
            db.exec(`DROP TRIGGER IF EXISTS atoms_ai`);
            db.exec(`DROP TRIGGER IF EXISTS atoms_ad`);
            db.exec(`DROP TRIGGER IF EXISTS atoms_au`);
            db.exec(`DROP TRIGGER IF EXISTS atoms_vec_ad`);
            db.exec(`DROP TABLE IF EXISTS atoms_fts`);
            db.exec(`DROP TABLE atoms`);
            db.exec(`ALTER TABLE atoms_new RENAME TO atoms`);
            // Recreate FTS mirror + sync triggers (dropped with the old table).
            db.exec(`CREATE VIRTUAL TABLE atoms_fts USING fts5(
        title, body, tags,
        content='atoms',
        content_rowid='rowid',
        tokenize='porter unicode61'
      )`);
            db.exec(`CREATE TRIGGER atoms_ai AFTER INSERT ON atoms BEGIN
        INSERT INTO atoms_fts(rowid, title, body, tags)
        VALUES (new.rowid, new.title, new.body, new.tags);
      END`);
            db.exec(`CREATE TRIGGER atoms_ad AFTER DELETE ON atoms BEGIN
        INSERT INTO atoms_fts(atoms_fts, rowid, title, body, tags)
        VALUES ('delete', old.rowid, old.title, old.body, old.tags);
      END`);
            db.exec(`CREATE TRIGGER atoms_au AFTER UPDATE ON atoms BEGIN
        INSERT INTO atoms_fts(atoms_fts, rowid, title, body, tags)
        VALUES ('delete', old.rowid, old.title, old.body, old.tags);
        INSERT INTO atoms_fts(rowid, title, body, tags)
        VALUES (new.rowid, new.title, new.body, new.tags);
      END`);
            db.exec(`INSERT INTO atoms_fts(atoms_fts) VALUES('rebuild')`);
            // Recreate atom indexes (dropped with the old table).
            db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_project ON atoms(project)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_type ON atoms(atom_type)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_scope ON atoms(scope)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_source ON atoms(source_path)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_hash ON atoms(content_hash)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_linked ON atoms(linked_at)`);
        })();
    }
    finally {
        db.pragma('foreign_keys = ON');
    }
    // Recreate the vec-delete trigger and clear stale vectors (rowids changed).
    // Guarded: vec0 may be unavailable.
    try {
        db.exec(`DELETE FROM atoms_vec`);
        db.exec(`CREATE TRIGGER IF NOT EXISTS atoms_vec_ad AFTER DELETE ON atoms BEGIN
      DELETE FROM atoms_vec WHERE rowid = old.rowid;
    END`);
    }
    catch { /* vector search disabled — embeddings rebuild on next reindex */ }
}
// ── Migration 8: project aliases ─────────────────────────────────────
// Records project slugs that were folded into a canonical slug by the
// git-root project-resolution merge (see src/capture/project-migrate.ts).
function migrateProjectAliases(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS project_aliases (
      alias_slug     TEXT PRIMARY KEY,
      canonical_slug TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
function migratePromotionClassification(db) {
    try {
        db.exec(`ALTER TABLE memories ADD COLUMN promotion_target TEXT NOT NULL DEFAULT 'none' CHECK(promotion_target IN ('none','adr','ddr','best_practice','recipe','note'))`);
    }
    catch { }
    try {
        db.exec(`ALTER TABLE memories ADD COLUMN promoted_to TEXT`);
    }
    catch { }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_promotion ON memories(promotion_target) WHERE promotion_target != 'none'`);
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
function migrateLoadAtInit(db) {
    try {
        db.exec(`ALTER TABLE atoms ADD COLUMN load_at_init INTEGER NOT NULL DEFAULT 0`);
    }
    catch { }
}
// ── Migration 2: memories tables ─────────────────────────────────────
// The autonomous memory engine's core. Memories are DB-owned (written by the
// Reflector), distinct from `atoms` which mirror on-disk file artifacts.
function migrateMemories(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      body              TEXT NOT NULL,
      memory_type       TEXT NOT NULL CHECK(memory_type IN (
        'preference', 'convention', 'failure', 'correction', 'decision',
        'insight', 'tool_quirk', 'reference', 'handoff'
      )),
      scope             TEXT NOT NULL DEFAULT 'project' CHECK(scope IN ('global', 'shared', 'project')),
      project           TEXT,
      confidence        REAL NOT NULL DEFAULT 0.6,
      decay_class       TEXT NOT NULL DEFAULT 'implementation' CHECK(decay_class IN (
        'stable', 'architecture', 'api_contract', 'implementation'
      )),
      last_verified_at  TEXT NOT NULL DEFAULT (datetime('now')),
      use_count         INTEGER NOT NULL DEFAULT 0,
      help_count        INTEGER NOT NULL DEFAULT 0,
      source_session_id TEXT,
      discovered_from   TEXT,
      superseded_by     TEXT REFERENCES memories(id) ON DELETE SET NULL,
      review_status     TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending', 'approved', 'rejected')),
      tags              TEXT NOT NULL DEFAULT '[]',
      content_hash      TEXT NOT NULL,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      load_at_init      INTEGER NOT NULL DEFAULT 0
    );

    -- Links spanning memories and atoms. No FK: target may live in either table.
    CREATE TABLE IF NOT EXISTS memory_links (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id   TEXT NOT NULL,
      target_id   TEXT NOT NULL,
      link_type   TEXT NOT NULL CHECK(link_type IN (
        'references', 'extends', 'refines', 'contradicts', 'supports', 'duplicates', 'related'
      )),
      confidence  REAL NOT NULL DEFAULT 1.0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_id, target_id, link_type)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      title, body, tags,
      content='memories',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, title, body, tags)
      VALUES (new.rowid, new.title, new.body, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, title, body, tags)
      VALUES ('delete', old.rowid, old.title, old.body, old.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, title, body, tags)
      VALUES ('delete', old.rowid, old.title, old.body, old.tags);
      INSERT INTO memories_fts(rowid, title, body, tags)
      VALUES (new.rowid, new.title, new.body, new.tags);
    END;

    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
    CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
    CREATE INDEX IF NOT EXISTS idx_memories_review ON memories(review_status);
    CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(content_hash);
    CREATE INDEX IF NOT EXISTS idx_memory_links_source ON memory_links(source_id);
    CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target_id);
  `);
    try {
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(embedding float[1024])`);
        db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_vec_ad AFTER DELETE ON memories BEGIN
        DELETE FROM memories_vec WHERE rowid = old.rowid;
      END;
    `);
    }
    catch (err) {
        console.warn('[claude-nexus] Could not create memories_vec table — vector search disabled:', err.message);
    }
}
// ── Migration 3: session reflection cursor ───────────────────────────
// Tracks how far the Reflector has processed each session's transcript.
function migrateReflectionCursor(db) {
    try {
        db.exec(`ALTER TABLE sessions ADD COLUMN last_reflected_index INTEGER NOT NULL DEFAULT 0`);
    }
    catch { }
}
// ── Migration 10: vcc_shrunk_at ──────────────────────────────────────
// ISO timestamp set when the raw session JSONL was last overwritten with
// vcc_compact output (inline shrink in reflect() or the cold-session backfill
// script). NULL = never shrunk — a safe backfill target.
function migrateVccShrunkAt(db) {
    try {
        db.exec(`ALTER TABLE sessions ADD COLUMN vcc_shrunk_at TEXT`);
    }
    catch { }
}
// ── Migration 11: distill cursor ─────────────────────────────────────
// Timestamp of the last distill run that pulled this memory into its candidate
// pool. NULL = never examined. src/core/distill.ts selects candidates with
// `distilled_at IS NULL` (optionally `OR distilled_at < :since`), so successive
// runs advance through the eligible set instead of re-pulling the same
// top-`limit` window forever. Survives restarts; needs no caller-passed offset.
function migrateDistillCursor(db) {
    try {
        db.exec(`ALTER TABLE memories ADD COLUMN distilled_at TEXT`);
    }
    catch { }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_distilled_at ON memories(distilled_at)`);
}
// ── Migration 4: import legacy memory atoms ──────────────────────────
// One-time copy of v1 knowledge atoms (memory/feedback/architecture) into the
// `memories` table. Source atoms are left in place — the indexer cut happens in
// a later phase once readers consume `memories`. Idempotent via INSERT OR IGNORE.
function migrateImportLegacyMemories(db) {
    const atomsExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='atoms'`).get();
    if (!atomsExists)
        return;
    db.transaction(() => {
        db.exec(`
      INSERT OR IGNORE INTO memories
        (id, title, body, memory_type, scope, project, confidence, decay_class,
         last_verified_at, use_count, help_count, source_session_id, discovered_from,
         superseded_by, review_status, tags, content_hash, created_at, updated_at, load_at_init)
      SELECT
        id, title, body,
        CASE atom_type
          WHEN 'feedback'     THEN 'correction'
          WHEN 'architecture' THEN 'decision'
          ELSE 'insight'
        END,
        scope, project, 0.6,
        CASE atom_type WHEN 'architecture' THEN 'architecture' ELSE 'implementation' END,
        updated_at, 0, 0, NULL, discovered_from,
        NULL, 'approved', tags, content_hash, created_at, updated_at, load_at_init
      FROM atoms
      WHERE atom_type IN ('memory', 'feedback', 'architecture');
    `);
    })();
}
// ── Migration 5: session-messages FTS ────────────────────────────────
// Full-text index over raw session message text. A user-facing feature
// (search past sessions in the dashboard) — never fed to the LLM.
function migrateSessionMessagesFts(db) {
    db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
      session_id, role, text,
      tokenize='porter unicode61'
    );
  `);
}
// ── Migration 6: corpus expansion ────────────────────────────────────
// Adds linked_at to atoms and memories (for hybrid linking skip guard),
// cwd to sessions (for project doc discovery), and extends atoms.source_type
// CHECK to include 'project_doc'. The atoms table requires a full recreate
// to extend the CHECK constraint — uses foreign_keys=OFF + transaction pattern.
function migrateCorpusExpansion(db) {
    // Guarded ALTER TABLE for memories.linked_at
    try {
        db.exec(`ALTER TABLE memories ADD COLUMN linked_at TEXT`);
    }
    catch { }
    // Guarded ALTER TABLE for sessions.cwd
    try {
        db.exec(`ALTER TABLE sessions ADD COLUMN cwd TEXT`);
    }
    catch { }
    // Full recreate of atoms table to extend source_type CHECK and add linked_at
    const schemaRow = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='atoms'`).get();
    if (!schemaRow)
        return;
    const needsRecreate = !schemaRow.sql.includes("'project_doc'");
    const needsLinkedAt = !schemaRow.sql.includes('linked_at');
    if (needsRecreate || needsLinkedAt) {
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
            'memory_file', 'agent_def', 'skill_def', 'plan_file', 'nexus_native', 'project_doc'
          )),
          project       TEXT,
          tags          TEXT NOT NULL DEFAULT '[]',
          content_hash  TEXT NOT NULL,
          frontmatter   TEXT,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
          linked_at     TEXT,
          status        TEXT,
          priority      INTEGER,
          blocks        TEXT,
          blocked_by    TEXT,
          discovered_from TEXT,
          load_at_init  INTEGER NOT NULL DEFAULT 0
        )`);
                db.exec(`INSERT INTO atoms_new
          (id, title, body, atom_type, scope, source_path, source_type, project, tags, content_hash, frontmatter, created_at, updated_at, status, priority, blocks, blocked_by, discovered_from, load_at_init)
          SELECT id, title, body, atom_type, scope, source_path, source_type, project, tags, content_hash, frontmatter, created_at, updated_at, status, priority, blocks, blocked_by, discovered_from, load_at_init
          FROM atoms`);
                db.exec(`DROP TRIGGER IF EXISTS atoms_ai`);
                db.exec(`DROP TRIGGER IF EXISTS atoms_ad`);
                db.exec(`DROP TRIGGER IF EXISTS atoms_au`);
                db.exec(`DROP TRIGGER IF EXISTS atoms_vec_ad`);
                db.exec(`DROP TABLE IF EXISTS atoms_fts`);
                db.exec(`DROP TABLE IF EXISTS atoms_vec`);
                db.exec(`DROP TABLE atoms`);
                db.exec(`ALTER TABLE atoms_new RENAME TO atoms`);
            })();
        }
        finally {
            db.pragma('foreign_keys = ON');
        }
        // Recreate FTS and vec tables (dropped above)
        db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS atoms_fts USING fts5(
        title, body, tags,
        content='atoms',
        content_rowid='rowid',
        tokenize='porter unicode61'
      );

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
    `);
        try {
            db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS atoms_vec USING vec0(embedding float[1024])`);
            db.exec(`
        CREATE TRIGGER IF NOT EXISTS atoms_vec_ad AFTER DELETE ON atoms BEGIN
          DELETE FROM atoms_vec WHERE rowid = old.rowid;
        END;
      `);
        }
        catch {
            // sqlite-vec not loaded — non-fatal
        }
        try {
            db.exec(`INSERT INTO atoms_fts(atoms_fts) VALUES('rebuild')`);
        }
        catch { }
    }
    else {
        // Table already has project_doc and linked_at — add linked_at column if still missing
        try {
            db.exec(`ALTER TABLE atoms ADD COLUMN linked_at TEXT`);
        }
        catch { }
    }
    // Index on linked_at for efficient skip-guard queries
    db.exec(`CREATE INDEX IF NOT EXISTS idx_atoms_linked ON atoms(linked_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_linked ON memories(linked_at)`);
}
//# sourceMappingURL=database.js.map