import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import os from 'os';
import matter from 'gray-matter';
import { openDatabase, initializeSchema } from '../core/database.js';
import { search, listAtoms, getAtomLinks, listSessions, getStats, getDiagnostics, } from '../core/search.js';
import { runFullIndex, reindexFile } from '../indexer/indexer.js';
import { refreshSessionStatuses } from './session-monitor.js';
const PORT = parseInt(process.env.NEXUS_PORT ?? '3210', 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '../../dist-frontend');
const db = openDatabase();
initializeSchema(db);
// Full index on startup
runFullIndex(db);
// Refresh session statuses every 10 seconds
refreshSessionStatuses(db);
setInterval(() => {
    try {
        refreshSessionStatuses(db);
    }
    catch { }
}, 10_000);
// Re-index all knowledge every 60 seconds to pick up new/changed memory files
setInterval(() => {
    try {
        runFullIndex(db);
    }
    catch { }
}, 60_000);
const app = express();
app.use(cors({
    origin: [
        'http://localhost:3210',
        'http://127.0.0.1:3210',
        'tauri://localhost',
        'https://tauri.localhost',
    ],
}));
app.use(express.json());
// Serve the built frontend
app.use(express.static(FRONTEND_DIR));
// --- Dashboard ---
app.get('/api/dashboard', (_req, res) => {
    const stats = getStats(db);
    const sessions = listSessions(db);
    const projectMap = new Map();
    for (const s of sessions) {
        const existing = projectMap.get(s.project);
        if (existing) {
            existing.sessions++;
            if (s.last_active && s.last_active > existing.lastActive) {
                existing.lastActive = s.last_active;
            }
        }
        else {
            projectMap.set(s.project, {
                sessions: 1,
                memories: stats.atomsByProject[s.project] ?? 0,
                lastActive: s.last_active ?? '',
            });
        }
    }
    const projects = [...projectMap.entries()].map(([name, data]) => ({
        project: name,
        ...data,
    }));
    const recentSessions = sessions.slice(0, 10).map(toSessionInfo);
    res.json({
        projects,
        recentSessions,
        totalMemories: stats.totalAtoms,
        totalSessions: stats.totalSessions,
    });
});
// --- Sessions ---
app.get('/api/sessions', (req, res) => {
    const { project, status } = req.query;
    const sessions = listSessions(db, { project, status });
    res.json(sessions.map(toSessionInfo));
});
app.get('/api/sessions/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(req.params.id);
    if (!row)
        return res.status(404).json({ error: 'Session not found' });
    res.json(toSessionInfo(row));
});
app.patch('/api/sessions/:id', (req, res) => {
    const { title } = req.body;
    if (!title)
        return res.status(400).json({ error: 'Missing title' });
    const result = db.prepare('UPDATE sessions SET custom_title = ? WHERE session_id = ?').run(title, req.params.id);
    if (result.changes === 0)
        return res.status(404).json({ error: 'Session not found' });
    const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(req.params.id);
    res.json(toSessionInfo(row));
});
// --- Memories / Atoms ---
app.get('/api/memories', (req, res) => {
    const { project, type, scope } = req.query;
    const atoms = listAtoms(db, { project, type, scope });
    res.json(atoms.map(toAtomResponse));
});
app.get('/api/memories/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM atoms WHERE id = ?').get(req.params.id);
    if (!row)
        return res.status(404).json({ error: 'Atom not found' });
    const links = getAtomLinks(db, row.id);
    const linked = links.map((l) => {
        const otherId = l.source_id === row.id ? l.target_id : l.source_id;
        const other = db.prepare('SELECT title FROM atoms WHERE id = ?').get(otherId);
        return { id: otherId, title: other?.title ?? otherId, type: l.link_type };
    });
    res.json({ ...toAtomResponse(row), links: linked });
});
// --- Plans, Agents, Skills (filtered atom lists) ---
app.get('/api/plans', (_req, res) => {
    const atoms = listAtoms(db, { type: 'plan' });
    res.json(atoms.map(toAtomResponse));
});
app.get('/api/agents', (_req, res) => {
    const atoms = db.prepare(`SELECT * FROM atoms WHERE source_type = 'agent_def' ORDER BY title`).all();
    res.json(atoms.map(toAtomResponse));
});
app.get('/api/skills', (_req, res) => {
    const atoms = db.prepare(`SELECT * FROM atoms WHERE source_type = 'skill_def' ORDER BY title`).all();
    res.json(atoms.map(toAtomResponse));
});
// --- Tasks ---
function resolveEffectiveStatus(task, allTasksById) {
    if (task.status === 'done' || task.status === 'in_progress')
        return task.status;
    const blockedBy = JSON.parse(task.blocked_by || '[]');
    for (const depId of blockedBy) {
        const dep = allTasksById.get(depId);
        if (!dep || dep.status !== 'done')
            return 'blocked';
    }
    return task.status || 'ready';
}
function toTaskResponse(task, effectiveStatus) {
    return {
        id: task.id,
        title: task.title,
        status: task.status || 'ready',
        effective_status: effectiveStatus,
        priority: task.priority ?? 2,
        project: task.project ?? '',
        tags: JSON.parse(task.tags || '[]'),
        blocks: JSON.parse(task.blocks || '[]'),
        blocked_by: JSON.parse(task.blocked_by || '[]'),
        discovered_from: task.discovered_from || '',
        created_at: task.created_at,
        summary: task.body.slice(0, 120),
    };
}
app.get('/api/tasks', (req, res) => {
    const { project, status, priority, include_done } = req.query;
    let sql = `SELECT * FROM atoms WHERE atom_type = 'task'`;
    const params = [];
    if (project) {
        sql += ` AND project = ?`;
        params.push(project);
    }
    if (priority) {
        sql += ` AND priority = ?`;
        params.push(parseInt(priority, 10));
    }
    const rows = db.prepare(sql).all(...params);
    const allTasksById = new Map(rows.map(r => [r.id, r]));
    const tasks = rows
        .map(r => ({ task: r, eff: resolveEffectiveStatus(r, allTasksById) }))
        .filter(({ task, eff }) => {
        if (include_done !== 'true' && (task.status === 'done' || eff === 'done'))
            return false;
        if (status && eff !== status)
            return false;
        return true;
    })
        .sort((a, b) => {
        const pa = a.task.priority ?? 2;
        const pb = b.task.priority ?? 2;
        if (pa !== pb)
            return pa - pb;
        return a.task.created_at.localeCompare(b.task.created_at);
    })
        .map(({ task, eff }) => toTaskResponse(task, eff));
    res.json(tasks);
});
app.patch('/api/tasks/:id', (req, res) => {
    const { status } = req.body;
    if (!status)
        return res.status(400).json({ error: 'Missing status' });
    const task = db.prepare(`SELECT * FROM atoms WHERE id = ? AND atom_type = 'task'`).get(req.params.id);
    if (!task)
        return res.status(404).json({ error: 'Task not found' });
    try {
        const now = new Date().toISOString();
        const fileContent = readFileSync(task.source_path, 'utf-8');
        const parsed = matter(fileContent);
        parsed.data.status = status;
        parsed.data.updated_at = now;
        const newContent = matter.stringify(parsed.content, parsed.data);
        writeFileSync(task.source_path, newContent, 'utf-8');
        db.prepare(`UPDATE atoms SET status = ?, updated_at = ? WHERE id = ?`)
            .run(status, now, task.id);
        const updated = db.prepare(`SELECT * FROM atoms WHERE id = ?`).get(task.id);
        const allTasks = db.prepare(`SELECT * FROM atoms WHERE atom_type = 'task'`).all();
        const allTasksById = new Map(allTasks.map(r => [r.id, r]));
        res.json(toTaskResponse(updated, resolveEffectiveStatus(updated, allTasksById)));
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.post('/api/tasks', (req, res) => {
    const { title, body, project, priority, tags, blocked_by, blocks } = req.body;
    if (!title)
        return res.status(400).json({ error: 'Missing title' });
    const now = new Date().toISOString();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const claudeDir = os.homedir() + '/.claude';
    const targetDir = project
        ? path.join(claudeDir, 'projects', project, 'memory')
        : path.join(claudeDir, 'nexus-atoms');
    if (!existsSync(targetDir))
        mkdirSync(targetDir, { recursive: true });
    let filename = `task_${slug}.md`;
    let filePath = path.join(targetDir, filename);
    let counter = 2;
    while (existsSync(filePath)) {
        filename = `task_${slug}_${counter}.md`;
        filePath = path.join(targetDir, filename);
        counter++;
    }
    const frontmatterLines = [
        '---',
        `title: "${title}"`,
        `atom_type: task`,
        `status: ready`,
        `priority: ${priority ?? 2}`,
        project ? `project: ${project}` : null,
        `tags: [${(tags ?? []).map(t => `"${t}"`).join(', ')}]`,
        `blocks: [${(blocks ?? []).map(b => `"${b}"`).join(', ')}]`,
        `blocked_by: [${(blocked_by ?? []).map(b => `"${b}"`).join(', ')}]`,
        `discovered_from: ""`,
        `created_at: ${now}`,
        `updated_at: ${now}`,
        '---',
    ].filter(Boolean).join('\n');
    try {
        writeFileSync(filePath, `${frontmatterLines}\n\n${body ?? ''}`, 'utf-8');
        reindexFile(db, filePath, project ? 'memory_file' : 'nexus_native');
        const atom = db.prepare(`SELECT * FROM atoms WHERE source_path = ? LIMIT 1`).get(filePath);
        if (!atom)
            return res.status(500).json({ error: 'Failed to index task' });
        const allTasks = db.prepare(`SELECT * FROM atoms WHERE atom_type = 'task'`).all();
        const allTasksById = new Map(allTasks.map(r => [r.id, r]));
        res.status(201).json(toTaskResponse(atom, resolveEffectiveStatus(atom, allTasksById)));
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// --- Search ---
app.get('/api/search', (req, res) => {
    const { q, type, project, limit } = req.query;
    if (!q)
        return res.status(400).json({ error: 'Missing query parameter q' });
    try {
        const results = search(db, q, {
            type,
            project,
            limit: limit ? parseInt(limit, 10) : 20,
        });
        res.json(results.map(r => ({
            id: r.atom.id,
            path: r.atom.source_path,
            project: r.atom.project,
            title: r.atom.title,
            type: r.atom.atom_type,
            snippet: r.snippet,
            score: r.rank,
        })));
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// --- Projects list ---
app.get('/api/projects', (_req, res) => {
    const rows = db.prepare(`SELECT DISTINCT COALESCE(project, 'global') as name FROM atoms ORDER BY name`).all();
    res.json(rows.map(r => r.name));
});
app.delete('/api/projects/:name', (req, res) => {
    const name = decodeURIComponent(req.params.name);
    const sessions = db.prepare('SELECT * FROM sessions WHERE project = ?').all(name);
    for (const s of sessions) {
        try {
            unlinkSync(s.jsonl_path);
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                console.warn(`[delete project] Failed to unlink session file ${s.jsonl_path}:`, e.message);
        }
    }
    db.prepare('DELETE FROM sessions WHERE project = ?').run(name);
    const atoms = db.prepare('SELECT * FROM atoms WHERE project = ?').all(name);
    for (const a of atoms) {
        try {
            unlinkSync(a.source_path);
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                console.warn(`[delete project] Failed to unlink atom file ${a.source_path}:`, e.message);
        }
    }
    db.prepare('DELETE FROM atoms WHERE project = ?').run(name);
    res.json({ success: true });
});
// --- Diagnostics ---
app.get('/api/diagnostics', (req, res) => {
    const { type } = req.query;
    res.json(getDiagnostics(db, type));
});
// --- Stats ---
app.get('/api/stats', (_req, res) => {
    res.json(getStats(db));
});
// --- Atom raw file content ---
app.get('/api/atoms/:id/raw', (req, res) => {
    const atom = db.prepare('SELECT * FROM atoms WHERE id = ?').get(req.params.id);
    if (!atom)
        return res.status(404).json({ error: 'Atom not found' });
    try {
        const content = readFileSync(atom.source_path, 'utf8');
        const match = content.match(/^---[\r\n][\s\S]*?[\r\n]---[\r\n]?/);
        const rawContent = match ? content.slice(match[0].length).trimStart() : content;
        res.json({ rawContent });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// --- Atom edit / delete / create ---
app.put('/api/atoms/:id', (req, res) => {
    const { body } = req.body;
    if (body === undefined)
        return res.status(400).json({ error: 'Missing body' });
    const atom = db.prepare('SELECT * FROM atoms WHERE id = ?').get(req.params.id);
    if (!atom)
        return res.status(404).json({ error: 'Atom not found' });
    try {
        const existing = readFileSync(atom.source_path, 'utf8');
        const match = existing.match(/^---[\r\n][\s\S]*?[\r\n]---[\r\n]/);
        const prefix = match ? match[0] : '';
        writeFileSync(atom.source_path, prefix + body, 'utf8');
        db.prepare('UPDATE atoms SET body = ?, updated_at = ? WHERE id = ?')
            .run(body, new Date().toISOString(), atom.id);
        const updated = db.prepare('SELECT * FROM atoms WHERE id = ?').get(atom.id);
        res.json(toAtomResponse(updated));
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.delete('/api/atoms/:id', (req, res) => {
    const atom = db.prepare('SELECT * FROM atoms WHERE id = ?').get(req.params.id);
    if (!atom)
        return res.status(404).json({ error: 'Atom not found' });
    try {
        unlinkSync(atom.source_path);
    }
    catch (e) {
        if (e.code !== 'ENOENT') {
            console.error(`[delete atom ${req.params.id}] Failed to unlink ${atom.source_path}:`, e);
            return res.status(500).json({ error: `Failed to delete file: ${e.message}`, code: e.code, path: atom.source_path });
        }
        console.warn(`[delete atom ${req.params.id}] File not found on disk (${atom.source_path}), removing DB entry`);
    }
    db.prepare('DELETE FROM atoms WHERE source_path = ?').run(atom.source_path);
    res.json({ success: true });
});
app.post('/api/atoms/create-memory', (req, res) => {
    const { name, type, description, body, sourceSessionId, sourceSessionSlug } = req.body;
    if (!name || !body)
        return res.status(400).json({ error: 'Missing name or body' });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const memoryDir = path.join(os.homedir(), '.claude', 'memory');
    if (!existsSync(memoryDir))
        mkdirSync(memoryDir, { recursive: true });
    const filePath = path.join(memoryDir, `${slug}.md`);
    const lines = [
        '---',
        `name: ${name}`,
        ...(description ? [`description: ${description}`] : []),
        `type: ${type || 'memory'}`,
        ...(sourceSessionId ? [`source_session_id: ${sourceSessionId}`] : []),
        ...(sourceSessionSlug ? [`source_session_slug: ${sourceSessionSlug}`] : []),
        '---',
        '',
    ];
    try {
        writeFileSync(filePath, lines.join('\n') + body, 'utf8');
        res.json({ success: true, path: filePath });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
function parseBlock(b) {
    if (!b?.type)
        return null;
    switch (b.type) {
        case 'text':
            return b.text?.trim() ? { type: 'text', text: b.text } : null;
        case 'thinking':
            return b.thinking?.trim() ? { type: 'thinking', text: b.thinking } : null;
        case 'image':
            if (b.source?.type === 'base64')
                return { type: 'image', mediaType: b.source.media_type ?? 'image/png', data: b.source.data };
            return null;
        case 'tool_use':
            return { type: 'tool_use', toolId: b.id ?? '', toolName: b.name ?? '', toolInput: b.input ?? {} };
        case 'tool_result': {
            let content = '';
            if (typeof b.content === 'string')
                content = b.content;
            else if (Array.isArray(b.content))
                content = b.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
            return { type: 'tool_result', toolUseId: b.tool_use_id ?? '', resultContent: content, isError: b.is_error };
        }
        default: return null;
    }
}
app.get('/api/sessions/:id/messages', (req, res) => {
    const session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(req.params.id);
    if (!session)
        return res.status(404).json({ error: 'Session not found' });
    try {
        const fileContent = readFileSync(session.jsonl_path, 'utf8');
        const messages = [];
        for (const line of fileContent.split('\n')) {
            if (!line.trim())
                continue;
            try {
                const entry = JSON.parse(line);
                if (entry.type !== 'user' && entry.type !== 'assistant')
                    continue;
                const raw = entry.message?.content;
                let blocks = [];
                if (typeof raw === 'string') {
                    if (raw.trim())
                        blocks = [{ type: 'text', text: raw }];
                }
                else if (Array.isArray(raw)) {
                    blocks = raw.map(parseBlock).filter((b) => b !== null);
                }
                if (blocks.length === 0)
                    continue;
                messages.push({
                    uuid: entry.uuid ?? '',
                    role: entry.type === 'user' ? 'user' : 'assistant',
                    blocks,
                    timestamp: entry.timestamp ?? '',
                });
            }
            catch { }
        }
        res.json({ messages });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// --- Session references + delete ---
app.get('/api/sessions/:id/references', (req, res) => {
    const rows = db.prepare(`SELECT id, title, source_path, frontmatter FROM atoms WHERE frontmatter IS NOT NULL AND frontmatter LIKE ?`).all(`%${req.params.id}%`);
    const references = rows
        .filter(r => {
        try {
            return JSON.parse(r.frontmatter).source_session_id === req.params.id;
        }
        catch {
            return false;
        }
    })
        .map(r => ({ id: r.id, title: r.title, path: r.source_path }));
    res.json({ references });
});
app.delete('/api/sessions/:id', (req, res) => {
    const session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(req.params.id);
    if (!session)
        return res.status(404).json({ error: 'Session not found' });
    try {
        unlinkSync(session.jsonl_path);
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            return res.status(500).json({ error: e.message });
    }
    db.prepare('DELETE FROM sessions WHERE session_id = ?').run(req.params.id);
    res.json({ success: true });
});
// SPA fallback — serve index.html for non-API routes
app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});
// --- Start ---
app.listen(PORT, () => {
    console.log(`Claude Nexus running on http://localhost:${PORT}`);
});
// --- Helpers ---
function toSessionInfo(s) {
    return {
        id: s.session_id,
        title: s.custom_title || s.title || s.project,
        project: s.project,
        slug: s.slug ?? undefined,
        lastActivity: s.last_active ?? s.started_at ?? '',
        messageCount: s.message_count ?? 0,
        status: mapStatus(s.status),
        pendingPrompt: s.status === 'waiting_input' ? s.summary : undefined,
        summary: s.summary ?? undefined,
    };
}
function mapStatus(s) {
    if (s === 'active' || s === 'processing')
        return 'active';
    if (s === 'waiting_input')
        return 'waiting';
    return 'idle';
}
function toAtomResponse(a) {
    return {
        id: a.id,
        path: a.source_path,
        project: a.project ?? 'global',
        title: a.title,
        type: a.atom_type,
        body: a.body,
        links: [],
        updatedAt: a.updated_at,
    };
}
//# sourceMappingURL=server.js.map