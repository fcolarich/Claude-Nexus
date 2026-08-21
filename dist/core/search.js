import { existsSync, readFileSync } from 'fs';
import { generateEmbedding } from './embeddings.js';
import { rrfFuse } from './rrf.js';
import { grepText } from './text-search.js';
import { readTranscriptWindow } from '../capture/transcript.js';
/**
 * Sanitize a query for FTS5 MATCH. Wraps each token in double quotes
 * to prevent special characters from crashing the query parser.
 * Passes through explicit FTS5 operators (AND, OR, NOT) and quoted phrases.
 */
export function sanitizeFts5Query(raw) {
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
 * Hybrid search: FTS5 BM25 + vector cosine via sqlite-vec, fused with Reciprocal Rank Fusion.
 * Falls back to FTS5-only search if Ollama is unavailable or atoms_vec does not exist.
 */
export async function hybridSearch(db, query, options) {
    const limit = options?.limit ?? 20;
    const RRF_K = 60;
    // Run FTS5 search (always available)
    const ftsResults = search(db, query, { ...options, limit });
    // Build FTS rank map: atomId -> rank (0-based position in results list)
    const ftsRank = new Map();
    for (let i = 0; i < ftsResults.length; i++) {
        ftsRank.set(ftsResults[i].atom.id, i);
    }
    // Attempt vector search
    let vecRank = new Map();
    let vecAtomIds = [];
    const queryVec = await generateEmbedding(query);
    if (queryVec !== null) {
        // Check atoms_vec exists before querying
        const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='atoms_vec'`).get();
        if (tableExists) {
            try {
                const vecRows = db.prepare(`
          SELECT rowid, distance FROM atoms_vec
          WHERE embedding MATCH json(?)
          ORDER BY distance
          LIMIT ?
        `).all(JSON.stringify(Array.from(queryVec)), limit);
                // Map rowid → atom id
                for (let i = 0; i < vecRows.length; i++) {
                    const atomRow = db.prepare(`SELECT id FROM atoms WHERE rowid = ?`).get(vecRows[i].rowid);
                    if (atomRow) {
                        vecRank.set(atomRow.id, i);
                        vecAtomIds.push(atomRow.id);
                    }
                }
            }
            catch (err) {
                console.warn('[hybridSearch] Vector query failed, falling back to FTS only:', err.message);
            }
        }
    }
    // If no vector results, return FTS results unchanged
    if (vecRank.size === 0) {
        return ftsResults;
    }
    // Collect all unique atom IDs from both result sets
    const allIds = new Set([
        ...ftsResults.map(r => r.atom.id),
        ...vecAtomIds,
    ]);
    // Compute RRF scores
    const rrfScores = new Map();
    for (const id of allIds) {
        const ftsPosScore = ftsRank.has(id) ? 1 / (RRF_K + ftsRank.get(id)) : 0;
        const vecPosScore = vecRank.has(id) ? 1 / (RRF_K + vecRank.get(id)) : 0;
        rrfScores.set(id, ftsPosScore + vecPosScore);
    }
    // Build a map of id → SearchResult (from FTS results — they have snippet)
    const resultByAtomId = new Map();
    for (const r of ftsResults) {
        resultByAtomId.set(r.atom.id, r);
    }
    // Fetch any atoms that appeared in vec results but not FTS
    for (const id of vecAtomIds) {
        if (!resultByAtomId.has(id)) {
            const row = db.prepare(`SELECT * FROM atoms WHERE id = ?`).get(id);
            if (row) {
                resultByAtomId.set(id, {
                    atom: {
                        ...row,
                        tags: JSON.parse(row.tags),
                        frontmatter: row.frontmatter ? JSON.parse(row.frontmatter) : null,
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
        ...resultByAtomId.get(id),
        rank: -(rrfScores.get(id) ?? 0), // negative so lower = better (consistent with BM25 convention)
    }));
}
/**
 * FTS5 search over the memories table (approved, non-superseded).
 */
export function searchMemories(db, query, options) {
    const sanitized = sanitizeFts5Query(query);
    const limit = options?.limit ?? 20;
    const ftsExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'`).get();
    if (!ftsExists)
        return [];
    let sql = `
    SELECT m.*, f.rank,
      snippet(memories_fts, 1, '<mark>', '</mark>', '...', 40) as snippet
    FROM memories_fts f
    JOIN memories m ON m.rowid = f.rowid
    WHERE memories_fts MATCH ?
      AND m.review_status = 'approved'
      AND m.superseded_by IS NULL
  `;
    const params = [sanitized];
    if (options?.project) {
        sql += ` AND m.project = ?`;
        params.push(options.project);
    }
    if (options?.scope) {
        sql += ` AND m.scope = ?`;
        params.push(options.scope);
    }
    sql += ` ORDER BY f.rank LIMIT ?`;
    params.push(limit);
    const rows = db.prepare(sql).all(...params);
    return rows.map(row => ({
        memory: { ...row, tags: JSON.parse(row.tags || '[]') },
        rank: row.rank,
        snippet: row.snippet,
    }));
}
/**
 * Hybrid (FTS5 + vector) search over memories, fused with RRF.
 * Falls back to FTS5-only if Ollama is unavailable or memories_vec does not exist.
 */
export async function hybridSearchMemories(db, query, options) {
    const limit = options?.limit ?? 20;
    const ftsResults = searchMemories(db, query, { ...options, limit });
    let vecMemIds = [];
    const queryVec = await generateEmbedding(query);
    if (queryVec !== null) {
        const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memories_vec'`).get();
        if (tableExists) {
            try {
                const vecRows = db.prepare(`
          SELECT rowid, distance FROM memories_vec
          WHERE embedding MATCH json(?)
          ORDER BY distance
          LIMIT ?
        `).all(JSON.stringify(Array.from(queryVec)), limit);
                for (let i = 0; i < vecRows.length; i++) {
                    const memRow = db.prepare(`
            SELECT id FROM memories
            WHERE rowid = ? AND review_status = 'approved' AND superseded_by IS NULL
          `).get(vecRows[i].rowid);
                    if (memRow) {
                        vecMemIds.push(memRow.id);
                    }
                }
            }
            catch (err) {
                console.warn('[hybridSearchMemories] Vector query failed:', err.message);
            }
        }
    }
    if (vecMemIds.length === 0)
        return ftsResults;
    // Map string memory IDs → integers for rrfFuse, then map back.
    const strToInt = new Map();
    let nextIdx = 0;
    for (const r of ftsResults) {
        if (!strToInt.has(r.memory.id))
            strToInt.set(r.memory.id, nextIdx++);
    }
    for (const id of vecMemIds) {
        if (!strToInt.has(id))
            strToInt.set(id, nextIdx++);
    }
    const intToStr = new Map();
    for (const [sid, idx] of strToInt)
        intToStr.set(idx, sid);
    const ftsNumIds = ftsResults.map(r => strToInt.get(r.memory.id));
    const vecNumIds = vecMemIds.map(id => strToInt.get(id));
    const fused = rrfFuse([ftsNumIds, vecNumIds]);
    // Hydrate results: FTS rows already have snippets; vec-only rows fetched on demand.
    const resultByMemId = new Map();
    for (const r of ftsResults)
        resultByMemId.set(r.memory.id, r);
    for (const id of vecMemIds) {
        if (!resultByMemId.has(id)) {
            const row = db.prepare(`
        SELECT * FROM memories WHERE id = ? AND review_status = 'approved' AND superseded_by IS NULL
      `).get(id);
            if (row) {
                resultByMemId.set(id, {
                    memory: { ...row, tags: JSON.parse(row.tags || '[]') },
                    rank: 0,
                    snippet: '',
                });
            }
        }
    }
    return fused
        .slice(0, limit)
        .flatMap(f => {
        const sid = intToStr.get(f.id);
        if (sid === undefined || !resultByMemId.has(sid))
            return [];
        return [{ ...resultByMemId.get(sid), rank: -f.score }];
    });
}
/**
 * Multi-topic smart fetch over the memories table.
 */
export function fetchMemoryContext(db, topics, options) {
    const seenIds = new Set();
    const allResults = [];
    for (const topic of topics) {
        for (const r of searchMemories(db, topic, { project: options?.project, limit: 5 })) {
            if (!seenIds.has(r.memory.id)) {
                seenIds.add(r.memory.id);
                allResults.push(r);
            }
        }
    }
    allResults.sort((a, b) => a.rank - b.rank);
    if (allResults.length === 0)
        return null;
    const parts = allResults.map(r => {
        const badge = r.memory.scope === 'global' ? ' [GLOBAL]' : r.memory.scope === 'shared' ? ' [SHARED]' : '';
        const conf = (r.memory.confidence * 100).toFixed(0);
        return `## [${r.memory.memory_type}] ${r.memory.title}${badge}\n_Captured memory | confidence: ${conf}% | ${r.memory.decay_class}_\n\n${r.memory.body}`;
    });
    return parts.join('\n\n---\n\n');
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
 * Get shared/global knowledge for session start.
 * Returns full content for atoms flagged load_at_init=true,
 * plus a compact titles-only index for all others.
 */
export function getSharedKnowledge(db) {
    const atoms = db.prepare(`
    SELECT * FROM atoms WHERE scope IN ('global', 'shared')
    ORDER BY load_at_init DESC, atom_type, title
  `).all();
    if (atoms.length === 0)
        return null;
    const initAtoms = atoms.filter(a => a.load_at_init);
    const indexAtoms = atoms.filter(a => !a.load_at_init);
    const parts = [];
    if (initAtoms.length > 0) {
        parts.push('# Session-Init Knowledge');
        for (const a of initAtoms) {
            const badge = a.scope === 'global' ? '[GLOBAL]' : '[SHARED]';
            parts.push(`## ${a.title} ${badge}\n_Type: ${a.atom_type}_\n\n${a.body}`);
        }
    }
    if (indexAtoms.length > 0) {
        parts.push('# Available Knowledge Index\n_Use nexus_search to load any of these:_');
        const byType = new Map();
        for (const a of indexAtoms) {
            if (!byType.has(a.atom_type))
                byType.set(a.atom_type, []);
            byType.get(a.atom_type).push(a.title);
        }
        for (const [type, titles] of byType) {
            parts.push(`**${type}**: ${titles.join(', ')}`);
        }
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
 * Look up a single session by id. Returns undefined on a miss — an unknown
 * session_id is an expected, common case the caller branches on, not an error.
 */
export function getSessionById(db, sessionId) {
    return db.prepare(`SELECT * FROM sessions WHERE session_id = ?`).get(sessionId);
}
/**
 * Record one session-content-search event. A plain, unguarded INSERT — no
 * try/catch here. The fail-open guard for search logging lives at the call
 * site in searchSession, so a constraint violation (e.g. a bad `source`)
 * propagates as a real throw from this thin wrapper.
 */
export function logSessionSearch(db, params) {
    db.prepare(`
    INSERT INTO session_search_log (session_id, query, source, match_count)
    VALUES (?, ?, ?, ?)
  `).run(params.sessionId, params.query, params.source, params.matchCount);
}
/**
 * Compacted-first session content search with fallback to the full transcript.
 * Never throws — an outer try/catch produces a safe 'no-content' fallback on
 * any unexpected internal error. Logs exactly once, at the end, from a single
 * fail-open call site covering every terminal path (see architecture.md).
 */
export function searchSession(db, sessionId, query, opts) {
    let result;
    try {
        const session = getSessionById(db, sessionId);
        if (!session) {
            result = {
                status: 'session-not-found',
                sessionId,
                query,
                source: 'none',
                sourcesChecked: [],
                matches: [],
                totalMatches: 0,
                truncated: false,
                detail: `No session found for session_id "${sessionId}"`,
            };
            logSearchFailOpen(db, sessionId, query, result);
            return result;
        }
        const sourcesChecked = [];
        // 1. Compacted summary, if present on disk.
        if (session.vcc_shrunk_path && existsSync(session.vcc_shrunk_path)) {
            sourcesChecked.push('compacted summary');
            const compactedText = readFileSync(session.vcc_shrunk_path, 'utf8');
            const grep = grepText(compactedText, query, opts);
            if (grep.totalMatches >= 1) {
                result = {
                    status: 'ok',
                    sessionId,
                    query,
                    source: 'compacted',
                    sourcesChecked,
                    matches: grep.matches,
                    totalMatches: grep.totalMatches,
                    truncated: grep.truncated,
                };
                logSearchFailOpen(db, sessionId, query, result);
                return result;
            }
        }
        // 2. Fallback: full transcript.
        let fullText = '';
        if (session.jsonl_path) {
            sourcesChecked.push('full transcript');
            fullText = readTranscriptWindow(session.jsonl_path, 0).text;
        }
        if (!fullText) {
            result = {
                status: 'no-content',
                sessionId,
                query,
                source: 'none',
                sourcesChecked,
                matches: [],
                totalMatches: 0,
                truncated: false,
                detail: session.jsonl_path
                    ? `No readable content at jsonl_path "${session.jsonl_path}"`
                    : 'Session has no jsonl_path',
            };
            logSearchFailOpen(db, sessionId, query, result);
            return result;
        }
        const grep = grepText(fullText, query, opts);
        if (grep.totalMatches >= 1) {
            result = {
                status: 'ok',
                sessionId,
                query,
                source: 'full',
                sourcesChecked,
                matches: grep.matches,
                totalMatches: grep.totalMatches,
                truncated: grep.truncated,
            };
            logSearchFailOpen(db, sessionId, query, result);
            return result;
        }
        // 3. Zero matches in every source actually checked.
        result = {
            status: 'no-matches',
            sessionId,
            query,
            source: 'none',
            sourcesChecked,
            matches: [],
            totalMatches: 0,
            truncated: false,
        };
        logSearchFailOpen(db, sessionId, query, result);
        return result;
    }
    catch (err) {
        result = {
            status: 'no-content',
            sessionId,
            query,
            source: 'none',
            sourcesChecked: [],
            matches: [],
            totalMatches: 0,
            truncated: false,
            detail: `Unexpected error: ${err.message}`,
        };
        logSearchFailOpen(db, sessionId, query, result);
        return result;
    }
}
/** Fail-open log write: swallow failures, stderr only, never stdout (stdio transport). */
function logSearchFailOpen(db, sessionId, query, result) {
    try {
        logSessionSearch(db, { sessionId, query, source: result.source, matchCount: result.totalMatches });
    }
    catch (err) {
        console.error('[searchSession] logSessionSearch failed:', err.message);
    }
}
/**
 * Count rows in a table, returning 0 if the table does not exist
 * (e.g. *_vec tables when sqlite-vec failed to load).
 */
function countTable(db, table) {
    const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    if (!exists)
        return 0;
    try {
        return db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get().c;
    }
    catch {
        return 0;
    }
}
/**
 * Get database statistics for the dashboard.
 */
export function getStats(db) {
    const totalAtoms = db.prepare(`SELECT COUNT(*) as c FROM atoms`).get().c;
    const totalLinks = db.prepare(`SELECT COUNT(*) as c FROM atom_links`).get().c;
    const totalSessions = db.prepare(`SELECT COUNT(*) as c FROM sessions`).get().c;
    const totalDiagnostics = db.prepare(`SELECT COUNT(*) as c FROM diagnostics`).get().c;
    const totalSessionSearches = db.prepare(`SELECT COUNT(*) as c FROM session_search_log`).get().c;
    const byType = db.prepare(`SELECT atom_type, COUNT(*) as c FROM atoms GROUP BY atom_type`).all();
    const byScope = db.prepare(`SELECT scope, COUNT(*) as c FROM atoms GROUP BY scope`).all();
    const byProject = db.prepare(`SELECT COALESCE(project, 'global') as project, COUNT(*) as c FROM atoms GROUP BY project`).all();
    const diagByType = db.prepare(`SELECT type, COUNT(*) as c FROM diagnostics GROUP BY type`).all();
    const searchBySource = db.prepare(`SELECT source, COUNT(*) as c FROM session_search_log GROUP BY source`).all();
    const totalMemories = countTable(db, 'memories');
    const memReview = totalMemories > 0
        ? db.prepare(`SELECT review_status, COUNT(*) as c FROM memories GROUP BY review_status`).all()
        : [];
    // GROUP BY only returns rows for sources that have ≥1 entry — zero-fill
    // all 3 keys before merging so unused sources still report 0, not undefined.
    const sessionSearchesBySource = { compacted: 0, full: 0, none: 0 };
    for (const row of searchBySource) {
        if (row.source === 'compacted' || row.source === 'full' || row.source === 'none') {
            sessionSearchesBySource[row.source] = row.c;
        }
    }
    return {
        totalAtoms,
        embeddedAtoms: countTable(db, 'atoms_vec'),
        atomsByType: Object.fromEntries(byType.map(r => [r.atom_type, r.c])),
        atomsByScope: Object.fromEntries(byScope.map(r => [r.scope, r.c])),
        atomsByProject: Object.fromEntries(byProject.map(r => [r.project, r.c])),
        totalMemories,
        embeddedMemories: countTable(db, 'memories_vec'),
        memoriesByReview: Object.fromEntries(memReview.map(r => [r.review_status, r.c])),
        totalLinks,
        totalSessions,
        totalDiagnostics,
        diagnosticsByType: Object.fromEntries(diagByType.map(r => [r.type, r.c])),
        totalSessionSearches,
        sessionSearchesBySource,
    };
}
//# sourceMappingURL=search.js.map