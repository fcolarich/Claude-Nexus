import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import os from 'os';
import { openDatabase, initializeSchema } from '../core/database.js';
import {
  search,
  listAtoms,
  getAtomLinks,
  listSessions,
  getStats,
  getDiagnostics,
} from '../core/search.js';
import { runFullIndex, reindexFile } from '../indexer/indexer.js';
import { resolveProjectSlug } from '../core/project-root.js';
import { reindexSessionMessages, searchSessionMessages } from '../indexer/session-messages.js';
import { refreshSessionStatuses } from './session-monitor.js';
import { reflect } from '../capture/reflector.js';
import { exportAll } from '../capture/export.js';
import { recallMemories } from '../core/recall.js';
import { flagStaleMemories, effectiveConfidence } from '../core/decay.js';
import { getNexusConfig } from '../core/config.js';
import { verifyMemory, recordFeedback, embedMemory } from '../core/memories.js';
import { consolidateMemories } from '../core/consolidate.js';
import { distillMemories } from '../core/distill.js';
import type { Atom, AtomLink, Session } from '../core/types.js';

const PORT = parseInt(process.env.NEXUS_PORT ?? '3210', 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '../../dist-frontend');

const db = openDatabase();
initializeSchema(db);

// Full index on startup (async — embedding pass runs after sync indexing)
runFullIndex(db).catch(err => console.warn('[web] runFullIndex error:', err));

// Refresh session statuses every 10 seconds
refreshSessionStatuses(db);
setInterval(() => {
  try { refreshSessionStatuses(db); } catch {}
}, 10_000);

// Re-index all knowledge every 60 seconds to pick up new/changed memory files
setInterval(() => {
  try { runFullIndex(db).catch(() => {}); } catch {}
  try { flagStaleMemories(db, getNexusConfig().recall.min_confidence); } catch {}
}, 60_000);

// Build the session-message search index shortly after startup (off the
// critical path). New sessions become searchable on the next restart.
setTimeout(() => {
  try { reindexSessionMessages(db); } catch {}
}, 3_000);

const app = express();
app.use(cors({
  origin: [
    'http://localhost:3210',
    'http://127.0.0.1:3210',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ],
}));
app.use(express.json());

// Serve the built frontend
app.use(express.static(FRONTEND_DIR));

// --- Capture (Reflector) ---
// Runs the Reflector over a session transcript. Returns 202 immediately;
// extraction + write + export happen in the background.
app.post('/api/reflect', (req, res) => {
  const { session_id, transcript_path, project, cwd } = (req.body ?? {}) as {
    session_id?: string; transcript_path?: string; project?: string; cwd?: string;
  };
  if (!session_id || !transcript_path) {
    return res.status(400).json({ error: 'session_id and transcript_path are required' });
  }

  res.status(202).json({ status: 'accepted', session_id });

  void (async () => {
    try {
      const result = await reflect(db, {
        session_id,
        transcript_path,
        project: project ?? (cwd ? resolveProjectSlug(cwd) : null),
        cwd,
      });
      if (!result.skipped && (result.inserted > 0 || result.merged > 0)) exportAll(db);
      console.log('[web] reflect:', JSON.stringify(result));
    } catch (err) {
      console.warn('[web] reflect error:', (err as Error).message);
    }
  })();
});

// --- Recall ---
// Budgeted memory retrieval. Synchronous (pure read). Used by the nexus-load
// SessionStart hook and the dashboard.
app.post('/api/recall', (req, res) => {
  const { project, cwd, query, maxTokens } = (req.body ?? {}) as {
    project?: string; cwd?: string; query?: string; maxTokens?: number;
  };
  const effectiveProject = project ?? (cwd ? resolveProjectSlug(cwd) : null);
  res.json(recallMemories(db, { project: effectiveProject, query, maxTokens }));
});

// --- Memory lifecycle ---
app.post('/api/memories/:id/verify', (req, res) => {
  res.json({ ok: verifyMemory(db, req.params.id) });
});
app.post('/api/memories/:id/feedback', (req, res) => {
  res.json({ ok: recordFeedback(db, req.params.id, !!(req.body?.helped)) });
});
app.post('/api/consolidate', (_req, res) => {
  consolidateMemories(db)
    .then(r => res.json(r))
    .catch(err => res.status(500).json({ error: (err as Error).message }));
});
app.post('/api/distill', (_req, res) => {
  distillMemories(db)
    .then(r => res.json(r))
    .catch(err => res.status(500).json({ error: (err as Error).message }));
});

// --- Dashboard ---
app.get('/api/dashboard', (_req, res) => {
  const stats = getStats(db);

  const sessions = listSessions(db);
  const projectMap = new Map<string, { sessions: number; memories: number; lastActive: string }>();

  for (const s of sessions) {
    const existing = projectMap.get(s.project);
    if (existing) {
      existing.sessions++;
      if (s.last_active && s.last_active > existing.lastActive) {
        existing.lastActive = s.last_active;
      }
    } else {
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
  const { project, status } = req.query as { project?: string; status?: string };
  const limit = Math.min(parseInt((req.query.limit as string) ?? '100', 10) || 100, 500);
  const offset = parseInt((req.query.offset as string) ?? '0', 10) || 0;
  const all = listSessions(db, { project, status });
  res.json({
    sessions: all.slice(offset, offset + limit).map(toSessionInfo),
    total: all.length,
    limit,
    offset,
  });
});

// Full-text search over raw session messages (user-facing — browse session history)
app.get('/api/sessions/search', (req, res) => {
  const q = (req.query.q as string) ?? '';
  res.json({ results: searchSessionMessages(db, q) });
});

app.get('/api/sessions/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  res.json(toSessionInfo(row as any));
});

app.patch('/api/sessions/:id', (req, res) => {
  const { title } = req.body as { title?: string };
  if (!title) return res.status(400).json({ error: 'Missing title' });
  const result = db.prepare('UPDATE sessions SET custom_title = ? WHERE session_id = ?').run(title, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Session not found' });
  const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(req.params.id);
  res.json(toSessionInfo(row as any));
});

// --- Memories (the v2 autonomous memory store) ---

function toMemoryResponse(row: Record<string, unknown>) {
  return {
    ...row,
    tags: JSON.parse((row.tags as string) || '[]'),
    load_at_init: !!row.load_at_init,
    effective_confidence: Number(effectiveConfidence(row as never).toFixed(3)),
  };
}

app.get('/api/memories', (req, res) => {
  const { review_status, memory_type, project, scope } = req.query as Record<string, string | undefined>;
  const limit = Math.min(parseInt((req.query.limit as string) ?? '100', 10) || 100, 500);
  const offset = parseInt((req.query.offset as string) ?? '0', 10) || 0;

  const where: string[] = ['superseded_by IS NULL'];
  const params: Record<string, unknown> = {};
  if (review_status) { where.push('review_status = @review_status'); params.review_status = review_status; }
  if (memory_type)   { where.push('memory_type = @memory_type'); params.memory_type = memory_type; }
  if (project)       { where.push('project = @project'); params.project = project; }
  if (scope)         { where.push('scope = @scope'); params.scope = scope; }
  const whereSql = where.join(' AND ');

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM memories WHERE ${whereSql}`).get(params) as { c: number }).c;
  const rows = db.prepare(`
    SELECT * FROM memories WHERE ${whereSql}
    ORDER BY confidence DESC, updated_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset }) as Record<string, unknown>[];

  res.json({ memories: rows.map(toMemoryResponse), total, limit, offset });
});

app.get('/api/memories/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ error: 'Memory not found' });
  res.json(toMemoryResponse(row));
});

app.put('/api/memories/:id', (req, res) => {
  const { title, body, tags } = req.body as { title?: string; body?: string; tags?: string[] };
  const existing = db.prepare('SELECT id FROM memories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Memory not found' });

  db.prepare(`
    UPDATE memories SET
      title = COALESCE(@title, title),
      body = COALESCE(@body, body),
      tags = COALESCE(@tags, tags),
      updated_at = datetime('now')
    WHERE id = @id
  `).run({
    id: req.params.id,
    title: title ?? null,
    body: body ?? null,
    tags: tags ? JSON.stringify(tags) : null,
  });

  if (body !== undefined) embedMemory(db, req.params.id).catch(() => {}); // body changed -> re-embed
  const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(req.params.id) as Record<string, unknown>;
  res.json(toMemoryResponse(updated));
});

app.post('/api/memories/:id/review', (req, res) => {
  const { status } = req.body as { status?: string };
  if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
    return res.status(400).json({ error: 'status must be approved, rejected, or pending' });
  }
  const r = db.prepare(`UPDATE memories SET review_status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Memory not found' });
  res.json({ ok: true, status });
});

app.delete('/api/memories/:id', (req, res) => {
  const r = db.prepare('DELETE FROM memories WHERE id = ?').run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Memory not found' });
  res.json({ ok: true });
});

// --- Plans, Agents, Skills (filtered atom lists) ---
app.get('/api/plans', (_req, res) => {
  const atoms = listAtoms(db, { type: 'plan' });
  res.json(atoms.map(toAtomResponse));
});

app.get('/api/agents', (_req, res) => {
  const atoms = db.prepare(`SELECT * FROM atoms WHERE source_type = 'agent_def' ORDER BY title`).all() as Atom[];
  res.json(atoms.map(toAtomResponse));
});

app.get('/api/skills', (_req, res) => {
  const atoms = db.prepare(`SELECT * FROM atoms WHERE source_type = 'skill_def' ORDER BY title`).all() as Atom[];
  res.json(atoms.map(toAtomResponse));
});

// --- Search ---
app.get('/api/search', (req, res) => {
  const { q, type, project, limit } = req.query as Record<string, string | undefined>;
  if (!q) return res.status(400).json({ error: 'Missing query parameter q' });
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
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// --- Projects list ---
app.get('/api/projects', (_req, res) => {
  const rows = db.prepare(`SELECT DISTINCT COALESCE(project, 'global') as name FROM atoms ORDER BY name`).all() as { name: string }[];
  res.json(rows.map(r => r.name));
});

app.delete('/api/projects/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);

  const sessions = db.prepare('SELECT * FROM sessions WHERE project = ?').all(name) as any[];
  for (const s of sessions) {
    try { unlinkSync(s.jsonl_path); } catch (e: any) {
      if (e.code !== 'ENOENT') console.warn(`[delete project] Failed to unlink session file ${s.jsonl_path}:`, e.message);
    }
  }
  db.prepare('DELETE FROM sessions WHERE project = ?').run(name);

  const atoms = db.prepare('SELECT * FROM atoms WHERE project = ?').all(name) as Atom[];
  for (const a of atoms) {
    try { unlinkSync(a.source_path); } catch (e: any) {
      if (e.code !== 'ENOENT') console.warn(`[delete project] Failed to unlink atom file ${a.source_path}:`, e.message);
    }
  }
  db.prepare('DELETE FROM atoms WHERE project = ?').run(name);

  res.json({ success: true });
});

// --- Diagnostics ---
app.get('/api/diagnostics', (req, res) => {
  const { type } = req.query as { type?: string };
  res.json(getDiagnostics(db, type));
});

// --- Stats ---
app.get('/api/stats', (_req, res) => {
  res.json(getStats(db));
});

// --- Atom raw file content ---

app.get('/api/atoms/:id/raw', (req, res) => {
  const atom = db.prepare('SELECT * FROM atoms WHERE id = ?').get(req.params.id) as Atom | undefined;
  if (!atom) return res.status(404).json({ error: 'Atom not found' });

  try {
    const content = readFileSync(atom.source_path, 'utf8');
    const match = content.match(/^---[\r\n][\s\S]*?[\r\n]---[\r\n]?/);
    const rawContent = match ? content.slice(match[0].length).trimStart() : content;
    res.json({ rawContent });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Atom edit / delete / create ---

app.put('/api/atoms/:id', (req, res) => {
  const { body } = req.body as { body?: string };
  if (body === undefined) return res.status(400).json({ error: 'Missing body' });

  const atom = db.prepare('SELECT * FROM atoms WHERE id = ?').get(req.params.id) as Atom | undefined;
  if (!atom) return res.status(404).json({ error: 'Atom not found' });

  try {
    const existing = readFileSync(atom.source_path, 'utf8');
    const match = existing.match(/^---[\r\n][\s\S]*?[\r\n]---[\r\n]/);
    const prefix = match ? match[0] : '';
    writeFileSync(atom.source_path, prefix + body, 'utf8');
    db.prepare('UPDATE atoms SET body = ?, updated_at = ? WHERE id = ?')
      .run(body, new Date().toISOString(), atom.id);
    const updated = db.prepare('SELECT * FROM atoms WHERE id = ?').get(atom.id) as Atom;
    res.json(toAtomResponse(updated));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/atoms/:id', (req, res) => {
  const atom = db.prepare('SELECT * FROM atoms WHERE id = ?').get(req.params.id) as Atom | undefined;
  if (!atom) return res.status(404).json({ error: 'Atom not found' });

  try {
    unlinkSync(atom.source_path);
  } catch (e: any) {
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
  const { name, type, description, body, sourceSessionId, sourceSessionSlug } = req.body as {
    name: string; type: string; description: string; body: string;
    sourceSessionId?: string; sourceSessionSlug?: string;
  };
  if (!name || !body) return res.status(400).json({ error: 'Missing name or body' });

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const memoryDir = path.join(os.homedir(), '.claude', 'memory');
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });

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
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Session messages (rich blocks) ---

type MsgBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; toolId: string; toolName: string; toolInput: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; resultContent: string; isError?: boolean };

function parseBlock(b: any): MsgBlock | null {
  if (!b?.type) return null;
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
      if (typeof b.content === 'string') content = b.content;
      else if (Array.isArray(b.content))
        content = b.content.filter((x: any) => x.type === 'text').map((x: any) => x.text).join('\n');
      return { type: 'tool_result', toolUseId: b.tool_use_id ?? '', resultContent: content, isError: b.is_error };
    }
    default: return null;
  }
}

app.get('/api/sessions/:id/messages', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(req.params.id) as any;
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const fileContent = readFileSync(session.jsonl_path, 'utf8');
    const messages: { uuid: string; role: string; blocks: MsgBlock[]; timestamp: string }[] = [];

    for (const line of fileContent.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'user' && entry.type !== 'assistant') continue;

        const raw = entry.message?.content;
        let blocks: MsgBlock[] = [];

        if (typeof raw === 'string') {
          if (raw.trim()) blocks = [{ type: 'text', text: raw }];
        } else if (Array.isArray(raw)) {
          blocks = raw.map(parseBlock).filter((b): b is MsgBlock => b !== null);
        }

        if (blocks.length === 0) continue;

        messages.push({
          uuid: entry.uuid ?? '',
          role: entry.type === 'user' ? 'user' : 'assistant',
          blocks,
          timestamp: entry.timestamp ?? '',
        });
      } catch {}
    }

    res.json({ messages });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Session references + delete ---

app.get('/api/sessions/:id/references', (req, res) => {
  const rows = db.prepare(
    `SELECT id, title, source_path, frontmatter FROM atoms WHERE frontmatter IS NOT NULL AND frontmatter LIKE ?`
  ).all(`%${req.params.id}%`) as any[];

  const references = rows
    .filter(r => {
      try { return JSON.parse(r.frontmatter).source_session_id === req.params.id; }
      catch { return false; }
    })
    .map(r => ({ id: r.id, title: r.title, path: r.source_path }));

  res.json({ references });
});

app.delete('/api/sessions/:id', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(req.params.id) as any;
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    unlinkSync(session.jsonl_path);
  } catch (e: any) {
    if (e.code !== 'ENOENT') return res.status(500).json({ error: e.message });
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
function toSessionInfo(s: Session) {
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

function mapStatus(s: string): 'active' | 'idle' | 'waiting' {
  if (s === 'active' || s === 'processing') return 'active';
  if (s === 'waiting_input') return 'waiting';
  return 'idle';
}

function toAtomResponse(a: any) {
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
