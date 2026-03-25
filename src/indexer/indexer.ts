import Database from 'better-sqlite3';
import { parseFile, computeAtomId } from './parser.js';
import { discoverSources, discoverSessions } from './scanner.js';
import { readFileSync, statSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import type { Atom, ParsedFile, SourceType } from '../core/types.js';

export interface IndexStats {
  atomsCreated: number;
  atomsUpdated: number;
  atomsUnchanged: number;
  linksCreated: number;
  diagnosticsCreated: number;
  sessionsIndexed: number;
}

// Prepared statements for performance
interface PreparedStatements {
  getAtomBySourceAndIndex: Database.Statement;
  upsertAtom: Database.Statement;
  deleteAtomsBySource: Database.Statement;
  insertLink: Database.Statement;
  deleteLinksForSource: Database.Statement;
  insertDiagnostic: Database.Statement;
  clearDiagnosticsForSource: Database.Statement;
  upsertSession: Database.Statement;
}

function prepareStatements(db: Database.Database): PreparedStatements {
  return {
    getAtomBySourceAndIndex: db.prepare(
      `SELECT id, content_hash FROM atoms WHERE source_path = ? AND id = ?`
    ),
    upsertAtom: db.prepare(`
      INSERT INTO atoms (id, title, body, atom_type, scope, source_path, source_type, project, tags, content_hash, frontmatter, updated_at)
      VALUES (@id, @title, @body, @atom_type, @scope, @source_path, @source_type, @project, @tags, @content_hash, @frontmatter, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        title = @title,
        body = @body,
        atom_type = @atom_type,
        scope = @scope,
        tags = @tags,
        content_hash = @content_hash,
        frontmatter = @frontmatter,
        updated_at = datetime('now')
    `),
    deleteAtomsBySource: db.prepare(
      `DELETE FROM atoms WHERE source_path = ?`
    ),
    insertLink: db.prepare(`
      INSERT OR IGNORE INTO atom_links (source_id, target_id, link_type, confidence)
      VALUES (?, ?, ?, ?)
    `),
    deleteLinksForSource: db.prepare(`
      DELETE FROM atom_links WHERE source_id IN (SELECT id FROM atoms WHERE source_path = ?)
    `),
    insertDiagnostic: db.prepare(`
      INSERT INTO diagnostics (type, atom_id, source_path, message, details)
      VALUES (?, ?, ?, ?, ?)
    `),
    clearDiagnosticsForSource: db.prepare(`
      DELETE FROM diagnostics WHERE source_path = ?
    `),
    upsertSession: db.prepare(`
      INSERT INTO sessions (session_id, project, git_branch, slug, jsonl_path, started_at, last_active, status, message_count, subagent_count, summary)
      VALUES (@session_id, @project, @git_branch, @slug, @jsonl_path, @started_at, @last_active, @status, @message_count, @subagent_count, @summary)
      ON CONFLICT(session_id) DO UPDATE SET
        last_active = @last_active,
        status = @status,
        message_count = @message_count,
        subagent_count = @subagent_count,
        summary = COALESCE(@summary, sessions.summary)
    `),
  };
}

/**
 * Index a single source file into the database.
 */
export function indexFile(
  db: Database.Database,
  stmts: PreparedStatements,
  filePath: string,
  sourceType: SourceType
): { created: number; updated: number; unchanged: number; links: number; diagnostics: number } {
  const result = { created: 0, updated: 0, unchanged: 0, links: 0, diagnostics: 0 };

  let parsed: ParsedFile;
  try {
    parsed = parseFile(filePath, sourceType);
  } catch (err) {
    // File might be malformed — log diagnostic and skip
    stmts.insertDiagnostic.run('stale', null, filePath, `Failed to parse: ${(err as Error).message}`, null);
    return result;
  }

  // Clear old links and diagnostics for this source
  stmts.deleteLinksForSource.run(filePath);
  stmts.clearDiagnosticsForSource.run(filePath);

  // Upsert atoms
  const atomIds: string[] = [];
  for (let i = 0; i < parsed.atoms.length; i++) {
    const atom = parsed.atoms[i];
    const id = computeAtomId(filePath, i);
    atomIds.push(id);

    // Check if unchanged
    const existing = stmts.getAtomBySourceAndIndex.get(filePath, id) as { id: string; content_hash: string } | undefined;
    if (existing && existing.content_hash === atom.content_hash) {
      result.unchanged++;
      continue;
    }

    stmts.upsertAtom.run({
      id,
      title: atom.title,
      body: atom.body,
      atom_type: atom.atom_type,
      scope: atom.scope,
      source_path: atom.source_path,
      source_type: atom.source_type,
      project: atom.project,
      tags: JSON.stringify(atom.tags),
      content_hash: atom.content_hash,
      frontmatter: atom.frontmatter ? JSON.stringify(atom.frontmatter) : null,
    });

    if (existing) {
      result.updated++;
    } else {
      result.created++;
    }
  }

  // Remove atoms that no longer exist in this file (sections removed)
  const allAtomsForSource = db.prepare(
    `SELECT id FROM atoms WHERE source_path = ?`
  ).all(filePath) as { id: string }[];
  for (const { id } of allAtomsForSource) {
    if (!atomIds.includes(id)) {
      db.prepare(`DELETE FROM atoms WHERE id = ?`).run(id);
    }
  }

  // Insert links (resolve target paths to atom IDs)
  for (const link of parsed.links) {
    const sourceId = atomIds[link.source_section];
    if (!sourceId) continue;

    // Find target atom by source_path
    const targetAtom = db.prepare(
      `SELECT id FROM atoms WHERE source_path = ? LIMIT 1`
    ).get(link.target_path) as { id: string } | undefined;

    if (targetAtom) {
      stmts.insertLink.run(sourceId, targetAtom.id, link.link_type, 1.0);
      result.links++;
    }
  }

  // Insert diagnostics
  for (const diag of parsed.diagnostics) {
    const atomId = atomIds[0] || null;
    stmts.insertDiagnostic.run(diag.type, atomId, filePath, diag.message, diag.details || null);
    result.diagnostics++;
  }

  return result;
}

/**
 * Index a session JSONL file — extracts metadata without parsing full conversation.
 */
export function indexSession(
  db: Database.Database,
  stmts: PreparedStatements,
  jsonlPath: string,
  projectSlug: string
): void {
  try {
    const stat = statSync(jsonlPath);
    const content = readFileSync(jsonlPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    if (lines.length === 0) return;

    let sessionId: string | null = null;
    let gitBranch: string | null = null;
    let slug: string | null = null;
    let startedAt: string | null = null;
    let lastActive: string | null = null;
    let summary: string | null = null;
    let messageCount = 0;

    // Parse first few lines for metadata
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.sessionId && !sessionId) sessionId = entry.sessionId;
        if (entry.timestamp && !startedAt) startedAt = entry.timestamp;
        if (entry.gitBranch && !gitBranch) gitBranch = entry.gitBranch;
        if (entry.slug && !slug) slug = entry.slug;

        // First user message as summary
        if (entry.type === 'user' && !summary && entry.message?.content) {
          const content = typeof entry.message.content === 'string'
            ? entry.message.content
            : Array.isArray(entry.message.content)
              ? entry.message.content.find((c: any) => c.type === 'text')?.text || ''
              : '';
          if (content) {
            summary = content.slice(0, 200);
          }
        }
      } catch {}
    }

    // Parse last line for timestamp
    try {
      const lastEntry = JSON.parse(lines[lines.length - 1]);
      lastActive = lastEntry.timestamp || null;
    } catch {}

    messageCount = lines.length;

    if (!sessionId) {
      // Extract from directory name
      const dirName = dirname(jsonlPath).split(/[/\\]/).pop();
      sessionId = dirName || jsonlPath;
    }

    // Count subagents
    const subagentDir = join(dirname(jsonlPath), 'subagents');
    let subagentCount = 0;
    if (existsSync(subagentDir)) {
      subagentCount = readdirSync(subagentDir).filter(f => f.endsWith('.meta.json')).length;
    }

    stmts.upsertSession.run({
      session_id: sessionId,
      project: projectSlug,
      git_branch: gitBranch,
      slug,
      jsonl_path: jsonlPath,
      started_at: startedAt,
      last_active: lastActive,
      status: 'dead', // Will be updated by session monitor
      message_count: messageCount,
      subagent_count: subagentCount,
      summary,
    });
  } catch {
    // Skip malformed JSONL files
  }
}

/**
 * Run a full index of all Claude data.
 */
export function runFullIndex(db: Database.Database): IndexStats {
  const stmts = prepareStatements(db);
  const stats: IndexStats = {
    atomsCreated: 0,
    atomsUpdated: 0,
    atomsUnchanged: 0,
    linksCreated: 0,
    diagnosticsCreated: 0,
    sessionsIndexed: 0,
  };

  // Index source files
  const sources = discoverSources();
  const indexAll = db.transaction(() => {
    for (const source of sources) {
      const result = indexFile(db, stmts, source.path, source.sourceType);
      stats.atomsCreated += result.created;
      stats.atomsUpdated += result.updated;
      stats.atomsUnchanged += result.unchanged;
      stats.linksCreated += result.links;
      stats.diagnosticsCreated += result.diagnostics;
    }
  });
  indexAll();

  // Detect orphan atoms (no links at all)
  const orphans = db.prepare(`
    SELECT a.id, a.source_path FROM atoms a
    WHERE a.id NOT IN (SELECT source_id FROM atom_links)
    AND a.id NOT IN (SELECT target_id FROM atom_links)
    AND a.atom_type NOT IN ('agent', 'skill', 'plan')
  `).all() as { id: string; source_path: string }[];

  for (const orphan of orphans) {
    stmts.insertDiagnostic.run('orphan', orphan.id, orphan.source_path,
      `Orphan atom: no links to or from this atom`, null);
  }

  // Infer links between atoms based on shared tags and co-location
  inferLinks(db, stmts);

  // Index sessions
  const sessions = discoverSessions();
  const indexSessions = db.transaction(() => {
    for (const session of sessions) {
      indexSession(db, stmts, session.path, session.project);
      stats.sessionsIndexed++;
    }
  });
  indexSessions();

  return stats;
}

/**
 * Infer semantic links between atoms based on:
 * 1. Shared tags (atoms with overlapping tags → "related")
 * 2. Same project + same memory directory (atoms in the same project memory → "related")
 * 3. Title/keyword overlap (atoms mentioning each other's titles → "references")
 */
function inferLinks(db: Database.Database, stmts: PreparedStatements): void {
  // Get all atoms with their tags
  const atoms = db.prepare(`SELECT id, title, tags, project, source_path, atom_type FROM atoms`).all() as {
    id: string; title: string; tags: string; project: string | null; source_path: string; atom_type: string;
  }[];

  const parsed = atoms.map(a => ({
    ...a,
    tagSet: new Set<string>(JSON.parse(a.tags) as string[]),
    titleWords: new Set(a.title.toLowerCase().split(/\W+/).filter(w => w.length > 3)),
  }));

  // Clear previously inferred links (confidence < 1.0) to re-derive them
  db.prepare(`DELETE FROM atom_links WHERE confidence < 1.0`).run();

  const insertLink = stmts.insertLink;

  // Link atoms from the same source file as a sequence ("extends" chain)
  const bySource = new Map<string, typeof parsed>();
  for (const a of parsed) {
    if (!bySource.has(a.source_path)) bySource.set(a.source_path, []);
    bySource.get(a.source_path)!.push(a);
  }
  for (const [, group] of bySource) {
    if (group.length < 2) continue;
    for (let k = 0; k < group.length - 1; k++) {
      insertLink.run(group[k].id, group[k + 1].id, 'extends', 0.95);
    }
  }

  for (let i = 0; i < parsed.length; i++) {
    const a = parsed[i];
    for (let j = i + 1; j < parsed.length; j++) {
      const b = parsed[j];

      // Skip same source file (handled above as sequence)
      if (a.source_path === b.source_path) continue;

      // 1. Shared tags → "related" with confidence proportional to overlap
      if (a.tagSet.size > 0 && b.tagSet.size > 0) {
        let shared = 0;
        for (const tag of a.tagSet) {
          if (b.tagSet.has(tag)) shared++;
        }
        if (shared >= 2) {
          const confidence = Math.min(0.9, 0.3 + shared * 0.15);
          insertLink.run(a.id, b.id, 'related', confidence);
          continue; // Don't double-link
        }
      }

      // 2. Title cross-reference: atom A's body mentions atom B's title (or vice versa)
      if (a.title.length > 5 && b.atom_type !== 'plan') {
        // Only check for meaningful title mentions (not super short/generic titles)
        const titleLower = a.title.toLowerCase();
        if (b.id !== a.id) {
          // Check if B's body contains A's title
          // Use a simple substring check for performance
          const bBodyLower = (db.prepare(`SELECT body FROM atoms WHERE id = ?`).get(b.id) as { body: string })?.body?.toLowerCase();
          if (bBodyLower && titleLower.length > 8 && bBodyLower.includes(titleLower)) {
            insertLink.run(b.id, a.id, 'references', 0.6);
            continue;
          }
        }
      }

      // 3. Same project memory atoms are related at low confidence
      if (a.project && a.project === b.project
        && a.atom_type !== 'plan' && b.atom_type !== 'plan'
        && a.source_path.includes('memory') && b.source_path.includes('memory')) {
        insertLink.run(a.id, b.id, 'related', 0.3);
      }
    }
  }
}

/**
 * Re-index a single file (for file watcher).
 */
export function reindexFile(db: Database.Database, filePath: string, sourceType: SourceType): void {
  const stmts = prepareStatements(db);
  const reindex = db.transaction(() => {
    indexFile(db, stmts, filePath, sourceType);
  });
  reindex();
}
