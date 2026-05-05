import Database from 'better-sqlite3';
import type { Atom, AtomLink, SearchResult, Diagnostic, Session } from './types.js';
import { generateEmbedding } from './embeddings.js';

/**
 * Sanitize a query for FTS5 MATCH. Wraps each token in double quotes
 * to prevent special characters from crashing the query parser.
 * Passes through explicit FTS5 operators (AND, OR, NOT) and quoted phrases.
 */
function sanitizeFts5Query(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '""';

  // If the user wrote a quoted phrase, pass it through
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed;

  // Split on whitespace, preserve FTS5 operators, quote everything else
  const FTS5_OPS = new Set(['AND', 'OR', 'NOT']);
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return tokens.map(t => {
    if (FTS5_OPS.has(t)) return t;
    // Allow prefix search (word*)
    if (t.endsWith('*')) {
      const base = t.slice(0, -1).replace(/"/g, '');
      return base ? `"${base}" *` : '""';
    }
    return `"${t.replace(/"/g, '')}"`;
  }).join(' ');
}

/**
 * Full-text search across all atoms using FTS5 BM25 ranking.
 */
export function search(
  db: Database.Database,
  query: string,
  options?: { project?: string; type?: string; scope?: string; limit?: number }
): SearchResult[] {
  const sanitized = sanitizeFts5Query(query);
  const limit = options?.limit ?? 20;
  let sql = `
    SELECT
      a.*,
      rank,
      snippet(atoms_fts, 1, '<mark>', '</mark>', '...', 40) as snippet
    FROM atoms_fts
    JOIN atoms a ON a.rowid = atoms_fts.rowid
    WHERE atoms_fts MATCH ?
  `;
  const params: unknown[] = [sanitized];

  if (options?.project) {
    sql += ` AND a.project = ?`;
    params.push(options.project);
  }
  if (options?.type) {
    sql += ` AND a.atom_type = ?`;
    params.push(options.type);
  }
  if (options?.scope) {
    sql += ` AND a.scope = ?`;
    params.push(options.scope);
  }

  sql += ` ORDER BY rank LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as (Atom & { rank: number; snippet: string })[];
  return rows.map(row => ({
    atom: {
      ...row,
      tags: JSON.parse(row.tags as unknown as string),
      frontmatter: row.frontmatter ? JSON.parse(row.frontmatter as unknown as string) : null,
    },
    rank: row.rank,
    snippet: row.snippet,
  }));
}

/**
 * Hybrid search: FTS5 BM25 + vector cosine via sqlite-vec, fused with Reciprocal Rank Fusion.
 * Falls back to FTS5-only search if Ollama is unavailable or atoms_vec does not exist.
 */
export async function hybridSearch(
  db: Database.Database,
  query: string,
  options?: { project?: string; type?: string; scope?: string; limit?: number }
): Promise<SearchResult[]> {
  const limit = options?.limit ?? 20;
  const RRF_K = 60;

  // Run FTS5 search (always available)
  const ftsResults = search(db, query, { ...options, limit });

  // Build FTS rank map: atomId -> rank (0-based position in results list)
  const ftsRank = new Map<string, number>();
  for (let i = 0; i < ftsResults.length; i++) {
    ftsRank.set(ftsResults[i].atom.id, i);
  }

  // Attempt vector search
  let vecRank = new Map<string, number>();
  let vecAtomIds: string[] = [];

  const queryVec = await generateEmbedding(query);
  if (queryVec !== null) {
    // Check atoms_vec exists before querying
    const tableExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='atoms_vec'`
    ).get();

    if (tableExists) {
      try {
        const vecRows = db.prepare(`
          SELECT rowid, distance FROM atoms_vec
          WHERE embedding MATCH json(?)
          ORDER BY distance
          LIMIT ?
        `).all(JSON.stringify(Array.from(queryVec)), limit) as { rowid: number; distance: number }[];

        // Map rowid → atom id
        for (let i = 0; i < vecRows.length; i++) {
          const atomRow = db.prepare(`SELECT id FROM atoms WHERE rowid = ?`).get(vecRows[i].rowid) as { id: string } | undefined;
          if (atomRow) {
            vecRank.set(atomRow.id, i);
            vecAtomIds.push(atomRow.id);
          }
        }
      } catch (err) {
        console.warn('[hybridSearch] Vector query failed, falling back to FTS only:', (err as Error).message);
      }
    }
  }

  // If no vector results, return FTS results unchanged
  if (vecRank.size === 0) {
    return ftsResults;
  }

  // Collect all unique atom IDs from both result sets
  const allIds = new Set<string>([
    ...ftsResults.map(r => r.atom.id),
    ...vecAtomIds,
  ]);

  // Compute RRF scores
  const rrfScores = new Map<string, number>();
  for (const id of allIds) {
    const ftsPosScore = ftsRank.has(id) ? 1 / (RRF_K + ftsRank.get(id)!) : 0;
    const vecPosScore = vecRank.has(id) ? 1 / (RRF_K + vecRank.get(id)!) : 0;
    rrfScores.set(id, ftsPosScore + vecPosScore);
  }

  // Build a map of id → SearchResult (from FTS results — they have snippet)
  const resultByAtomId = new Map<string, SearchResult>();
  for (const r of ftsResults) {
    resultByAtomId.set(r.atom.id, r);
  }

  // Fetch any atoms that appeared in vec results but not FTS
  for (const id of vecAtomIds) {
    if (!resultByAtomId.has(id)) {
      const row = db.prepare(`SELECT * FROM atoms WHERE id = ?`).get(id) as (Atom & { tags: string; frontmatter: string | null }) | undefined;
      if (row) {
        resultByAtomId.set(id, {
          atom: {
            ...row,
            tags: JSON.parse(row.tags as unknown as string),
            frontmatter: row.frontmatter ? JSON.parse(row.frontmatter as unknown as string) : null,
          },
          rank: 0,
          snippet: '',
        });
      }
    }
  }

  // Sort by RRF score descending, return top `limit`
  const sorted = Array.from(allIds)
    .filter(id => resultByAtomId.has(id))
    .sort((a, b) => (rrfScores.get(b) ?? 0) - (rrfScores.get(a) ?? 0))
    .slice(0, limit);

  return sorted.map(id => ({
    ...resultByAtomId.get(id)!,
    rank: -(rrfScores.get(id) ?? 0), // negative so lower = better (consistent with BM25 convention)
  }));
}

/**
 * "Smart fetch" — search for multiple topics and merge results into one markdown block.
 * This is the key MCP optimization: one tool call, all relevant context.
 */
export function fetchContext(
  db: Database.Database,
  topics: string[],
  options?: { project?: string; maxTokensEstimate?: number }
): string | null {
  const allResults: SearchResult[] = [];
  const seenIds = new Set<string>();

  for (const topic of topics) {
    const results = search(db, topic, { project: options?.project, limit: 5 });
    for (const r of results) {
      if (!seenIds.has(r.atom.id)) {
        seenIds.add(r.atom.id);
        allResults.push(r);
      }
    }
  }

  // Sort by relevance (best rank first, rank is negative — closer to 0 is better)
  allResults.sort((a, b) => a.rank - b.rank);

  if (allResults.length === 0) return null;

  // Merge into markdown
  const parts: string[] = [];
  for (const r of allResults) {
    const scopeBadge = r.atom.scope === 'global' ? '[GLOBAL]' : r.atom.scope === 'shared' ? '[SHARED]' : '';
    const source = r.atom.project ? `${r.atom.project}` : 'global';
    parts.push(`## ${r.atom.title} ${scopeBadge}\n_Source: ${source} | ${r.atom.atom_type}_\n\n${r.atom.body}`);
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Get all atoms with global or shared scope.
 */
export function getSharedKnowledge(db: Database.Database): string | null {
  const atoms = db.prepare(`
    SELECT * FROM atoms WHERE scope IN ('global', 'shared') ORDER BY scope, atom_type, title
  `).all() as Atom[];

  if (atoms.length === 0) return null;

  const parts: string[] = [];
  for (const a of atoms) {
    const scopeBadge = a.scope === 'global' ? '[GLOBAL]' : '[SHARED]';
    parts.push(`## ${a.title} ${scopeBadge}\n_Type: ${a.atom_type}_\n\n${a.body}`);
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Get all atoms for a specific project.
 */
export function getProjectContext(db: Database.Database, project: string): string | null {
  const atoms = db.prepare(`
    SELECT * FROM atoms WHERE project = ? ORDER BY atom_type, title
  `).all(project) as Atom[];

  if (atoms.length === 0) return null;

  const parts: string[] = [];
  for (const a of atoms) {
    parts.push(`## ${a.title}\n_Type: ${a.atom_type} | Scope: ${a.scope}_\n\n${a.body}`);
  }

  return parts.join('\n\n---\n\n');
}

/**
 * List all atoms with optional filtering.
 */
export function listAtoms(
  db: Database.Database,
  options?: { type?: string; scope?: string; project?: string }
): Atom[] {
  let sql = `SELECT * FROM atoms WHERE 1=1`;
  const params: unknown[] = [];

  if (options?.type) {
    sql += ` AND atom_type = ?`;
    params.push(options.type);
  }
  if (options?.scope) {
    sql += ` AND scope = ?`;
    params.push(options.scope);
  }
  if (options?.project) {
    sql += ` AND project = ?`;
    params.push(options.project);
  }

  sql += ` ORDER BY project, atom_type, title`;
  return db.prepare(sql).all(...params) as Atom[];
}

/**
 * Get all links for an atom (both directions).
 */
export function getAtomLinks(db: Database.Database, atomId: string): AtomLink[] {
  return db.prepare(`
    SELECT * FROM atom_links
    WHERE source_id = ? OR target_id = ?
    ORDER BY link_type, confidence DESC
  `).all(atomId, atomId) as AtomLink[];
}

/**
 * Get all diagnostics, optionally filtered by type.
 */
export function getDiagnostics(
  db: Database.Database,
  type?: string
): Diagnostic[] {
  if (type) {
    return db.prepare(`SELECT * FROM diagnostics WHERE type = ? ORDER BY created_at DESC`).all(type) as Diagnostic[];
  }
  return db.prepare(`SELECT * FROM diagnostics ORDER BY type, created_at DESC`).all() as Diagnostic[];
}

/**
 * Get all sessions, optionally filtered.
 */
export function listSessions(
  db: Database.Database,
  options?: { project?: string; status?: string }
): Session[] {
  let sql = `SELECT * FROM sessions WHERE 1=1`;
  const params: unknown[] = [];

  if (options?.project) {
    sql += ` AND project = ?`;
    params.push(options.project);
  }
  if (options?.status) {
    sql += ` AND status = ?`;
    params.push(options.status);
  }

  sql += ` ORDER BY last_active DESC`;
  return db.prepare(sql).all(...params) as Session[];
}

/**
 * Get database statistics for the dashboard.
 */
export function getStats(db: Database.Database): {
  totalAtoms: number;
  atomsByType: Record<string, number>;
  atomsByScope: Record<string, number>;
  atomsByProject: Record<string, number>;
  totalLinks: number;
  totalSessions: number;
  totalDiagnostics: number;
  diagnosticsByType: Record<string, number>;
} {
  const totalAtoms = (db.prepare(`SELECT COUNT(*) as c FROM atoms`).get() as { c: number }).c;
  const totalLinks = (db.prepare(`SELECT COUNT(*) as c FROM atom_links`).get() as { c: number }).c;
  const totalSessions = (db.prepare(`SELECT COUNT(*) as c FROM sessions`).get() as { c: number }).c;
  const totalDiagnostics = (db.prepare(`SELECT COUNT(*) as c FROM diagnostics`).get() as { c: number }).c;

  const byType = db.prepare(`SELECT atom_type, COUNT(*) as c FROM atoms GROUP BY atom_type`).all() as { atom_type: string; c: number }[];
  const byScope = db.prepare(`SELECT scope, COUNT(*) as c FROM atoms GROUP BY scope`).all() as { scope: string; c: number }[];
  const byProject = db.prepare(`SELECT COALESCE(project, 'global') as project, COUNT(*) as c FROM atoms GROUP BY project`).all() as { project: string; c: number }[];
  const diagByType = db.prepare(`SELECT type, COUNT(*) as c FROM diagnostics GROUP BY type`).all() as { type: string; c: number }[];

  return {
    totalAtoms,
    atomsByType: Object.fromEntries(byType.map(r => [r.atom_type, r.c])),
    atomsByScope: Object.fromEntries(byScope.map(r => [r.scope, r.c])),
    atomsByProject: Object.fromEntries(byProject.map(r => [r.project, r.c])),
    totalLinks,
    totalSessions,
    totalDiagnostics,
    diagnosticsByType: Object.fromEntries(diagByType.map(r => [r.type, r.c])),
  };
}
