/**
 * Sanitize a query for FTS5 MATCH. Wraps each token in double quotes
 * to prevent special characters from crashing the query parser.
 * Passes through explicit FTS5 operators (AND, OR, NOT) and quoted phrases.
 */
function sanitizeFts5Query(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return '""';
    // If the user wrote a quoted phrase, pass it through
    if (trimmed.startsWith('"') && trimmed.endsWith('"'))
        return trimmed;
    // Split on whitespace, preserve FTS5 operators, quote everything else
    const FTS5_OPS = new Set(['AND', 'OR', 'NOT']);
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    return tokens.map(t => {
        if (FTS5_OPS.has(t))
            return t;
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
export function search(db, query, options) {
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
    const params = [sanitized];
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
    const rows = db.prepare(sql).all(...params);
    return rows.map(row => ({
        atom: {
            ...row,
            tags: JSON.parse(row.tags),
            frontmatter: row.frontmatter ? JSON.parse(row.frontmatter) : null,
        },
        rank: row.rank,
        snippet: row.snippet,
    }));
}
/**
 * "Smart fetch" — search for multiple topics and merge results into one markdown block.
 * This is the key MCP optimization: one tool call, all relevant context.
 */
export function fetchContext(db, topics, options) {
    const allResults = [];
    const seenIds = new Set();
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
    if (allResults.length === 0)
        return null;
    // Merge into markdown
    const parts = [];
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
export function getSharedKnowledge(db) {
    const atoms = db.prepare(`
    SELECT * FROM atoms WHERE scope IN ('global', 'shared') ORDER BY scope, atom_type, title
  `).all();
    if (atoms.length === 0)
        return null;
    const parts = [];
    for (const a of atoms) {
        const scopeBadge = a.scope === 'global' ? '[GLOBAL]' : '[SHARED]';
        parts.push(`## ${a.title} ${scopeBadge}\n_Type: ${a.atom_type}_\n\n${a.body}`);
    }
    return parts.join('\n\n---\n\n');
}
/**
 * Get all atoms for a specific project.
 */
export function getProjectContext(db, project) {
    const atoms = db.prepare(`
    SELECT * FROM atoms WHERE project = ? ORDER BY atom_type, title
  `).all(project);
    if (atoms.length === 0)
        return null;
    const parts = [];
    for (const a of atoms) {
        parts.push(`## ${a.title}\n_Type: ${a.atom_type} | Scope: ${a.scope}_\n\n${a.body}`);
    }
    return parts.join('\n\n---\n\n');
}
/**
 * List all atoms with optional filtering.
 */
export function listAtoms(db, options) {
    let sql = `SELECT * FROM atoms WHERE 1=1`;
    const params = [];
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
    return db.prepare(sql).all(...params);
}
/**
 * Get all links for an atom (both directions).
 */
export function getAtomLinks(db, atomId) {
    return db.prepare(`
    SELECT * FROM atom_links
    WHERE source_id = ? OR target_id = ?
    ORDER BY link_type, confidence DESC
  `).all(atomId, atomId);
}
/**
 * Get all diagnostics, optionally filtered by type.
 */
export function getDiagnostics(db, type) {
    if (type) {
        return db.prepare(`SELECT * FROM diagnostics WHERE type = ? ORDER BY created_at DESC`).all(type);
    }
    return db.prepare(`SELECT * FROM diagnostics ORDER BY type, created_at DESC`).all();
}
/**
 * Get all sessions, optionally filtered.
 */
export function listSessions(db, options) {
    let sql = `SELECT * FROM sessions WHERE 1=1`;
    const params = [];
    if (options?.project) {
        sql += ` AND project = ?`;
        params.push(options.project);
    }
    if (options?.status) {
        sql += ` AND status = ?`;
        params.push(options.status);
    }
    sql += ` ORDER BY last_active DESC`;
    return db.prepare(sql).all(...params);
}
/**
 * Get database statistics for the dashboard.
 */
export function getStats(db) {
    const totalAtoms = db.prepare(`SELECT COUNT(*) as c FROM atoms`).get().c;
    const totalLinks = db.prepare(`SELECT COUNT(*) as c FROM atom_links`).get().c;
    const totalSessions = db.prepare(`SELECT COUNT(*) as c FROM sessions`).get().c;
    const totalDiagnostics = db.prepare(`SELECT COUNT(*) as c FROM diagnostics`).get().c;
    const byType = db.prepare(`SELECT atom_type, COUNT(*) as c FROM atoms GROUP BY atom_type`).all();
    const byScope = db.prepare(`SELECT scope, COUNT(*) as c FROM atoms GROUP BY scope`).all();
    const byProject = db.prepare(`SELECT COALESCE(project, 'global') as project, COUNT(*) as c FROM atoms GROUP BY project`).all();
    const diagByType = db.prepare(`SELECT type, COUNT(*) as c FROM diagnostics GROUP BY type`).all();
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
//# sourceMappingURL=search.js.map