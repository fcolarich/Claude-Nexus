import { parseFile, computeAtomId } from './parser.js';
import { discoverSources, discoverSessions } from './scanner.js';
import { importSessionTitles, backfillTitlesFromSummary, generateTitle } from './session-titles.js';
import { readFileSync, statSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
function prepareStatements(db) {
    return {
        getAtomBySourceAndIndex: db.prepare(`SELECT id, content_hash FROM atoms WHERE source_path = ? AND id = ?`),
        upsertAtom: db.prepare(`
      INSERT INTO atoms (id, title, body, atom_type, scope, source_path, source_type, project, tags, content_hash, frontmatter, updated_at, status, priority, blocks, blocked_by, discovered_from)
      VALUES (@id, @title, @body, @atom_type, @scope, @source_path, @source_type, @project, @tags, @content_hash, @frontmatter, datetime('now'), @status, @priority, @blocks, @blocked_by, @discovered_from)
      ON CONFLICT(id) DO UPDATE SET
        title = @title,
        body = @body,
        atom_type = @atom_type,
        scope = @scope,
        tags = @tags,
        content_hash = @content_hash,
        frontmatter = @frontmatter,
        updated_at = datetime('now'),
        status = @status,
        priority = @priority,
        blocks = @blocks,
        blocked_by = @blocked_by,
        discovered_from = @discovered_from
    `),
        deleteAtomsBySource: db.prepare(`DELETE FROM atoms WHERE source_path = ?`),
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
      INSERT INTO sessions (session_id, project, git_branch, slug, jsonl_path, started_at, last_active, status, message_count, subagent_count, summary, title)
      VALUES (@session_id, @project, @git_branch, @slug, @jsonl_path, @started_at, @last_active, @status, @message_count, @subagent_count, @summary, @title)
      ON CONFLICT(session_id) DO UPDATE SET
        last_active = @last_active,
        status = @status,
        message_count = @message_count,
        subagent_count = @subagent_count,
        summary = COALESCE(@summary, sessions.summary),
        title = COALESCE(sessions.custom_title, @title, sessions.title)
    `),
    };
}
/**
 * Index a single source file into the database.
 */
export function indexFile(db, stmts, filePath, sourceType) {
    const result = { created: 0, updated: 0, unchanged: 0, links: 0, diagnostics: 0 };
    let parsed;
    try {
        parsed = parseFile(filePath, sourceType);
    }
    catch (err) {
        // File might be malformed — log diagnostic and skip
        stmts.insertDiagnostic.run('stale', null, filePath, `Failed to parse: ${err.message}`, null);
        return result;
    }
    // Clear old links and diagnostics for this source
    stmts.deleteLinksForSource.run(filePath);
    stmts.clearDiagnosticsForSource.run(filePath);
    // Upsert atoms
    const atomIds = [];
    for (let i = 0; i < parsed.atoms.length; i++) {
        const atom = parsed.atoms[i];
        const id = computeAtomId(filePath, i);
        atomIds.push(id);
        // Check if unchanged
        const existing = stmts.getAtomBySourceAndIndex.get(filePath, id);
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
            status: atom.status ?? null,
            priority: atom.priority ?? null,
            blocks: atom.blocks ?? null,
            blocked_by: atom.blocked_by ?? null,
            discovered_from: atom.discovered_from ?? null,
        });
        if (existing) {
            result.updated++;
        }
        else {
            result.created++;
        }
    }
    // Remove atoms that no longer exist in this file (sections removed)
    const allAtomsForSource = db.prepare(`SELECT id FROM atoms WHERE source_path = ?`).all(filePath);
    for (const { id } of allAtomsForSource) {
        if (!atomIds.includes(id)) {
            db.prepare(`DELETE FROM atoms WHERE id = ?`).run(id);
        }
    }
    // Insert links (resolve target paths to atom IDs)
    for (const link of parsed.links) {
        const sourceId = atomIds[link.source_section];
        if (!sourceId)
            continue;
        // Find target atom by source_path
        const targetAtom = db.prepare(`SELECT id FROM atoms WHERE source_path = ? LIMIT 1`).get(link.target_path);
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
export function indexSession(db, stmts, jsonlPath, projectSlug) {
    try {
        const stat = statSync(jsonlPath);
        const content = readFileSync(jsonlPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length === 0)
            return;
        let sessionId = null;
        let gitBranch = null;
        let slug = null;
        let startedAt = null;
        let lastActive = null;
        let summary = null;
        let messageCount = 0;
        // Parse first few lines for metadata
        for (let i = 0; i < Math.min(lines.length, 20); i++) {
            try {
                const entry = JSON.parse(lines[i]);
                if (entry.sessionId && !sessionId)
                    sessionId = entry.sessionId;
                if (entry.timestamp && !startedAt)
                    startedAt = entry.timestamp;
                if (entry.gitBranch && !gitBranch)
                    gitBranch = entry.gitBranch;
                if (entry.slug && !slug)
                    slug = entry.slug;
                // First user message as summary
                if (entry.type === 'user' && !summary && entry.message?.content) {
                    const content = typeof entry.message.content === 'string'
                        ? entry.message.content
                        : Array.isArray(entry.message.content)
                            ? entry.message.content.find((c) => c.type === 'text')?.text || ''
                            : '';
                    if (content) {
                        summary = content.slice(0, 200);
                    }
                }
            }
            catch { }
        }
        // Parse last line for timestamp
        try {
            const lastEntry = JSON.parse(lines[lines.length - 1]);
            lastActive = lastEntry.timestamp || null;
        }
        catch { }
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
        const title = summary ? generateTitle(summary) : null;
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
            title,
        });
    }
    catch {
        // Skip malformed JSONL files
    }
}
/**
 * Run a full index of all Claude data.
 */
export function runFullIndex(db) {
    const stmts = prepareStatements(db);
    const stats = {
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
    // Detect orphans and infer links in a single transaction
    const postProcess = db.transaction(() => {
        const orphans = db.prepare(`
      SELECT a.id, a.source_path FROM atoms a
      WHERE a.id NOT IN (SELECT source_id FROM atom_links)
      AND a.id NOT IN (SELECT target_id FROM atom_links)
      AND a.atom_type NOT IN ('agent', 'skill', 'plan')
    `).all();
        for (const orphan of orphans) {
            stmts.insertDiagnostic.run('orphan', orphan.id, orphan.source_path, `Orphan atom: no links to or from this atom`, null);
        }
        inferLinks(db, stmts);
    });
    postProcess();
    // Index sessions
    const sessions = discoverSessions();
    const indexSessions = db.transaction(() => {
        for (const session of sessions) {
            indexSession(db, stmts, session.path, session.project);
            stats.sessionsIndexed++;
        }
    });
    indexSessions();
    // Import richer session data from Claude's own metadata DB
    importSessionTitles(db);
    backfillTitlesFromSummary(db);
    return stats;
}
/**
 * Infer semantic links between atoms based on:
 * 1. Shared tags (atoms with overlapping tags → "related")
 * 2. Same project + same memory directory (atoms in the same project memory → "related")
 * 3. Title/keyword overlap (atoms mentioning each other's titles → "references")
 */
function inferLinks(db, stmts) {
    // Get all atoms with their tags and body (avoids per-pair queries)
    const atoms = db.prepare(`SELECT id, title, body, tags, project, source_path, atom_type FROM atoms`).all();
    const parsed = atoms.map(a => ({
        ...a,
        bodyLower: a.body.toLowerCase(),
        tagSet: new Set(JSON.parse(a.tags)),
        titleLower: a.title.toLowerCase(),
    }));
    // Clear previously inferred links (confidence < 1.0) to re-derive them
    db.prepare(`DELETE FROM atom_links WHERE confidence < 1.0`).run();
    const insertLink = stmts.insertLink;
    // Link atoms from the same source file as a sequence ("extends" chain)
    const bySource = new Map();
    for (const a of parsed) {
        if (!bySource.has(a.source_path))
            bySource.set(a.source_path, []);
        bySource.get(a.source_path).push(a);
    }
    for (const [, group] of bySource) {
        if (group.length < 2)
            continue;
        for (let k = 0; k < group.length - 1; k++) {
            insertLink.run(group[k].id, group[k + 1].id, 'extends', 0.95);
        }
    }
    for (let i = 0; i < parsed.length; i++) {
        const a = parsed[i];
        for (let j = i + 1; j < parsed.length; j++) {
            const b = parsed[j];
            // Skip same source file (handled above as sequence)
            if (a.source_path === b.source_path)
                continue;
            // 1. Shared tags → "related" with confidence proportional to overlap
            if (a.tagSet.size > 0 && b.tagSet.size > 0) {
                let shared = 0;
                for (const tag of a.tagSet) {
                    if (b.tagSet.has(tag))
                        shared++;
                }
                if (shared >= 2) {
                    const confidence = Math.min(0.9, 0.3 + shared * 0.15);
                    insertLink.run(a.id, b.id, 'related', confidence);
                    continue;
                }
            }
            // 2. Title cross-reference: atom A's title appears in atom B's body
            if (a.titleLower.length > 8 && b.atom_type !== 'plan') {
                if (b.bodyLower.includes(a.titleLower)) {
                    insertLink.run(b.id, a.id, 'references', 0.6);
                    continue;
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
export function reindexFile(db, filePath, sourceType) {
    const stmts = prepareStatements(db);
    const reindex = db.transaction(() => {
        indexFile(db, stmts, filePath, sourceType);
    });
    reindex();
}
//# sourceMappingURL=indexer.js.map