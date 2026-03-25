import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { openDatabase, initializeSchema } from '../core/database.js';
import {
  search,
  listAtoms,
  getAtomLinks,
  listSessions,
  getStats,
  getDiagnostics,
} from '../core/search.js';
import { refreshSessionStatuses } from './session-monitor.js';
import type { Atom, AtomLink } from '../core/types.js';

const PORT = parseInt(process.env.NEXUS_PORT ?? '3210', 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '../../dist-frontend');

const db = openDatabase();
initializeSchema(db);

// Refresh session statuses on startup and every 10 seconds
refreshSessionStatuses(db);
setInterval(() => {
  try { refreshSessionStatuses(db); } catch {}
}, 10_000);

const app = express();
app.use(cors());
app.use(express.json());

// Serve the built frontend
app.use(express.static(FRONTEND_DIR));

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
  const sessions = listSessions(db, { project, status });
  res.json(sessions.map(toSessionInfo));
});

app.get('/api/sessions/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  res.json(toSessionInfo(row as any));
});

// --- Memories / Atoms ---
app.get('/api/memories', (req, res) => {
  const { project, type, scope } = req.query as Record<string, string | undefined>;
  const atoms = listAtoms(db, { project, type, scope });
  res.json(atoms.map(toAtomResponse));
});

app.get('/api/memories/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM atoms WHERE id = ?').get(req.params.id) as Atom | undefined;
  if (!row) return res.status(404).json({ error: 'Atom not found' });

  const links = getAtomLinks(db, row.id);
  const linked = links.map((l: AtomLink) => {
    const otherId = l.source_id === row.id ? l.target_id : l.source_id;
    const other = db.prepare('SELECT title FROM atoms WHERE id = ?').get(otherId) as { title: string } | undefined;
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

// --- Diagnostics ---
app.get('/api/diagnostics', (req, res) => {
  const { type } = req.query as { type?: string };
  res.json(getDiagnostics(db, type));
});

// --- Stats ---
app.get('/api/stats', (_req, res) => {
  res.json(getStats(db));
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
function toSessionInfo(s: any) {
  return {
    id: s.session_id,
    project: s.project,
    lastActivity: s.last_active ?? s.started_at ?? '',
    messageCount: s.message_count ?? 0,
    status: mapStatus(s.status),
    pendingPrompt: s.status === 'waiting_input' ? s.summary : undefined,
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
