import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import matter from 'gray-matter';
import { openDatabase, initializeSchema } from '../core/database.js';
import { runFullIndex, reindexFile, cwdToProjectSlug } from '../indexer/indexer.js';
import { buildBm25Corpus, rrfMerge } from '../core/links.js';
import type { RankedResult } from '../core/links.js';
import { generateEmbedding } from '../core/embeddings.js';
import type { CrossRefResult, LinkType } from '../core/types.js';
import { computeAtomId, computeHash } from '../indexer/parser.js';
import type { Atom, TaskAtom, TaskStatus } from '../core/types.js';
import {
  search,
  hybridSearch,
  hybridSearchMemories,
  fetchContext,
  fetchMemoryContext,
  getSharedKnowledge,
  getProjectContext,
  listSessions,
  getDiagnostics,
  getStats,
  listAtoms,
} from '../core/search.js';
import { recallMemories } from '../core/recall.js';
import { verifyMemory, recordFeedback, insertMemory, embedMemory } from '../core/memories.js';
import type { MemoryType, DecayClass } from '../core/types.js';
import { consolidateMemories } from '../core/consolidate.js';
import { distillMemories } from '../core/distill.js';
import { backfillSessions } from '../capture/backfill.js';

// Initialize database and index on startup
const db = openDatabase();
initializeSchema(db);
// runFullIndex is now async (embedding pass runs after sync indexing)
runFullIndex(db).catch(err => console.warn('[server] runFullIndex error:', err));


const server = new McpServer({
  name: 'claude-nexus',
  version: '0.1.0',
});

/**
 * Resolve a project slug from a working-directory path.
 * 1. Derived slug via cwdToProjectSlug (full path convention, e.g. "C--Fran-Monster-Hotel").
 * 2. Short-name fallback (last path segment lowercased, e.g. "monster-hotel"). Handles projects
 *    whose tasks were created with a short name rather than the full path slug.
 * Each candidate is checked against atoms AND sessions so backfill resolution works too.
 */
function resolveProjectFromCwd(cwd: string): string {
  const known = (slug: string) =>
    !!db.prepare(`SELECT 1 FROM atoms    WHERE project = ? LIMIT 1`).get(slug) ||
    !!db.prepare(`SELECT 1 FROM sessions WHERE project = ? LIMIT 1`).get(slug);

  const derived = cwdToProjectSlug(cwd);
  if (derived && known(derived)) return derived;

  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
  const shortName = parts[parts.length - 1]?.toLowerCase().replace(/_/g, '-');
  if (shortName && shortName !== derived?.toLowerCase() && known(shortName)) return shortName;

  return derived ?? shortName ?? cwd;
}

// ── nexus_search ─────────────────────────────────────────────────────

server.tool(
  'nexus_search',
  'Cross-project full-text search across all Claude knowledge: captured memories AND agents/skills/plans/notes. Returns both stores merged into one markdown response.',
  {
    query:   z.string().describe('Search query (supports FTS5 syntax: AND, OR, NOT, "phrases", prefix*)'),
    project: z.string().optional().describe('Filter by full project slug (e.g. "C--Fran-Monster-Hotel"). Prefer cwd to avoid guessing the slug.'),
    cwd:     z.string().optional().describe('Caller working directory — derives the project slug automatically. Use instead of project when searching within the current project.'),
    type:    z.string().optional().describe('Filter atoms by type: agent, skill, plan, task, project_note, architecture (omit to include all)'),
    scope:   z.string().optional().describe('Filter by scope: global, shared, project'),
    limit:   z.coerce.number().optional().describe('Max results per store (default: 10)'),
  },
  async ({ query, project, cwd, type, scope, limit }) => {
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(cwd) : undefined);
    const cap = limit ?? 10;

    const [atomResults, memResults] = await Promise.all([
      hybridSearch(db, query, { project: effectiveProject, type, scope, limit: cap }),
      hybridSearchMemories(db, query, { project: effectiveProject, scope, limit: cap }),
    ]);

    if (atomResults.length === 0 && memResults.length === 0) {
      return { content: [{ type: 'text', text: 'No results found.' }] };
    }

    const parts: string[] = [];

    if (memResults.length > 0) {
      parts.push('## Captured Memories');
      for (const r of memResults) {
        const badge = r.memory.scope === 'global' ? ' [GLOBAL]' : r.memory.scope === 'shared' ? ' [SHARED]' : '';
        const conf = (r.memory.confidence * 100).toFixed(0);
        parts.push(`### [${r.memory.memory_type}] ${r.memory.title}${badge}\n_Confidence: ${conf}% | ${r.memory.decay_class}_\n\n${r.memory.body}`);
      }
    }

    if (atomResults.length > 0) {
      if (parts.length > 0) parts.push('---');
      parts.push('## Knowledge Atoms (agents, skills, plans, notes)');
      for (const r of atomResults) {
        const badge = r.atom.scope === 'global' ? ' [GLOBAL]' : r.atom.scope === 'shared' ? ' [SHARED]' : '';
        const source = r.atom.project || 'global';
        parts.push(`### ${r.atom.title}${badge ? ' ' + badge : ''}\n_Source: ${source} | ${r.atom.atom_type}_\n\n${r.atom.body}`);
      }
    }

    return {
      content: [{ type: 'text', text: parts.join('\n\n') }],
    };
  }
);

// ── nexus_context ────────────────────────────────────────────────────

server.tool(
  'nexus_context',
  'Smart fetch: request multiple topics and receive one merged response with all relevant knowledge from both captured memories and knowledge atoms. One tool call, precisely targeted context.',
  {
    topics:  z.array(z.string()).describe('List of topics to fetch (e.g., ["ECS architecture", "coding preferences", "WebGL bridge"])'),
    project: z.string().optional().describe('Scope to a full project slug (e.g. "C--Fran-Monster-Hotel"). Prefer cwd to avoid guessing the slug.'),
    cwd:     z.string().optional().describe('Caller working directory — derives the project slug automatically. Use instead of project when scoping to the current project.'),
  },
  async ({ topics, project, cwd }) => {
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(cwd) : undefined);

    const memMerged = fetchMemoryContext(db, topics, { project: effectiveProject });
    const atomMerged = fetchContext(db, topics, { project: effectiveProject });

    if (!memMerged && !atomMerged) {
      return { content: [{ type: 'text', text: 'No knowledge found for the given topics.' }] };
    }

    const parts: string[] = [];
    if (memMerged) parts.push(memMerged);
    if (atomMerged) parts.push(atomMerged);

    return { content: [{ type: 'text', text: parts.join('\n\n---\n\n') }] };
  }
);

// ── nexus_recall ─────────────────────────────────────────────────────

server.tool(
  'nexus_recall',
  'Recall the most relevant memories for the current project, budgeted to a token cap. With no query, returns session-start context (preferences, conventions, decisions, handoffs). With a query, restricts to memories matching that topic. Ranked by confidence, recency, and helpfulness; full bodies until the budget is reached, then titles only.',
  {
    project:    z.string().optional().describe('Full project slug. Prefer cwd to avoid guessing the slug.'),
    cwd:        z.string().optional().describe('Caller working directory — derives the project slug automatically.'),
    query:      z.string().optional().describe('Optional topic to focus recall on. Omit for general session-start recall.'),
    max_tokens: z.coerce.number().optional().describe('Token budget for injected memory (default from extraction_models.yaml).'),
  },
  async ({ project, cwd, query, max_tokens }) => {
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(cwd) : null);
    const result = recallMemories(db, { project: effectiveProject, query, maxTokens: max_tokens });

    if (result.items.length === 0) {
      return { content: [{ type: 'text', text: 'No memories recalled.' }] };
    }
    return { content: [{ type: 'text', text: result.markdown }] };
  }
);

// ── nexus_shared ─────────────────────────────────────────────────────

server.tool(
  'nexus_shared',
  'Get global/shared knowledge for session start. Returns full content for atoms flagged load_at_init=true, plus a compact titles-only index of all other global/shared atoms. Use nexus_set_init to flag atoms for full loading.',
  {},
  async () => {
    const merged = getSharedKnowledge(db);

    if (!merged) {
      return { content: [{ type: 'text', text: 'No shared knowledge atoms found.' }] };
    }

    return { content: [{ type: 'text', text: merged }] };
  }
);

// ── nexus_set_init ───────────────────────────────────────────────────

server.tool(
  'nexus_set_init',
  'Toggle the load_at_init flag on a global or shared atom. When true, nexus_shared returns that atom\'s full content at session start. Use nexus_search to find atom IDs.',
  {
    id: z.string().describe('Atom ID to update'),
    load_at_init: z.boolean().describe('true = load full content at session start; false = titles-only index'),
  },
  async ({ id, load_at_init }) => {
    const atom = db.prepare(`SELECT * FROM atoms WHERE id = ?`).get(id) as Atom | undefined;
    if (!atom) {
      return { content: [{ type: 'text', text: `Error: atom not found with id ${id}` }] };
    }
    if (atom.scope === 'project') {
      return { content: [{ type: 'text', text: `Error: load_at_init only applies to global or shared atoms (this atom is project-scoped)` }] };
    }

    const raw = await readFile(atom.source_path, 'utf-8');
    const parsed = matter(raw);
    parsed.data.load_at_init = load_at_init;
    await writeFile(atom.source_path, matter.stringify(parsed.content, parsed.data), 'utf-8');

    db.prepare(`UPDATE atoms SET load_at_init = ? WHERE id = ?`).run(load_at_init ? 1 : 0, id);

    return {
      content: [{ type: 'text', text: `"${atom.title}" — load_at_init set to ${load_at_init}` }],
    };
  }
);

// ── nexus_project ────────────────────────────────────────────────────

server.tool(
  'nexus_project',
  'Get all knowledge atoms for a specific project. Returns project memories, notes, and architecture docs merged into one response.',
  {
    project: z.string().optional().describe('Full project slug (e.g. "C--Fran-RRDestructible"). Prefer cwd to avoid guessing the slug.'),
    cwd:     z.string().optional().describe('Caller working directory — derives the project slug automatically.'),
  },
  async ({ project, cwd }) => {
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(cwd) : undefined);

    if (!effectiveProject) {
      return { content: [{ type: 'text', text: 'Error: provide project or cwd.' }] };
    }

    const merged = getProjectContext(db, effectiveProject);

    if (!merged) {
      return { content: [{ type: 'text', text: `No atoms found for project: ${effectiveProject}` }] };
    }

    return { content: [{ type: 'text', text: merged }] };
  }
);

// ── nexus_sessions ───────────────────────────────────────────────────

server.tool(
  'nexus_sessions',
  'List Claude Code sessions with their status, project, branch, and message counts.',
  {
    project: z.string().optional().describe('Filter by project slug'),
    status: z.string().optional().describe('Filter by status: active, waiting_input, processing, idle, dead'),
  },
  async ({ project, status }) => {
    const sessions = listSessions(db, { project, status });

    if (sessions.length === 0) {
      return { content: [{ type: 'text', text: 'No sessions found.' }] };
    }

    const lines = sessions.slice(0, 20).map(s => {
      const branch = s.git_branch ? ` (${s.git_branch})` : '';
      const date = s.last_active ? new Date(s.last_active).toLocaleDateString() : 'unknown';
      return `- **[${s.status}]** ${s.project}${branch} — ${date}, ${s.message_count} msgs, ${s.subagent_count} subagents${s.summary ? `\n  ${s.summary.slice(0, 120)}` : ''}`;
    });

    return {
      content: [{ type: 'text', text: `# Sessions (${sessions.length} total)\n\n${lines.join('\n')}` }],
    };
  }
);

// ── nexus_health ─────────────────────────────────────────────────────

server.tool(
  'nexus_health',
  'Show diagnostics: broken references, duplicates, orphan atoms, missing frontmatter. Use to audit knowledge graph health.',
  {
    type: z.string().optional().describe('Filter: broken_reference, missing_frontmatter, duplicate, orphan, stale'),
  },
  async ({ type }) => {
    const diags = getDiagnostics(db, type);
    const stats = getStats(db);

    const summary = `# Nexus Health Report

**Atoms:** ${stats.totalAtoms} | **Links:** ${stats.totalLinks} | **Sessions:** ${stats.totalSessions}
**Issues:** ${stats.totalDiagnostics}

${Object.entries(stats.diagnosticsByType).map(([t, c]) => `- ${t}: ${c}`).join('\n')}

## Details

${diags.map(d => `- **[${d.type}]** ${d.message}${d.details ? `\n  ${d.details}` : ''}`).join('\n')}`;

    return { content: [{ type: 'text', text: summary }] };
  }
);

// ── nexus_remember ───────────────────────────────────────────────────

// Maps legacy atom_type values to memory_type for the memories store.
const ATOM_TYPE_TO_MEMORY_TYPE: Record<string, MemoryType> = {
  memory: 'insight',
  feedback: 'correction',
  reference: 'reference',
  project_note: 'decision',
  architecture: 'decision',
};

// Default decay class per memory type.
const MEMORY_TYPE_DECAY: Record<MemoryType, DecayClass> = {
  preference: 'stable',
  convention: 'stable',
  reference: 'stable',
  decision: 'architecture',
  insight: 'implementation',
  correction: 'api_contract',
  failure: 'api_contract',
  tool_quirk: 'api_contract',
  handoff: 'implementation',
};

server.tool(
  'nexus_remember',
  'Store knowledge in the memories store (or a task atom). For knowledge: writes to the memories table so it is searchable by nexus_search and recallable by nexus_recall. Use atom_type="task" for task atoms (stored in atoms table).',
  {
    title:       z.string().describe('Short title for the memory'),
    content:     z.string().describe('Body — 1–4 self-contained sentences with the durable lesson and its why'),
    scope:       z.enum(['global', 'shared', 'project']).describe('Scope: global (all projects), shared (related projects), project (current only)'),
    memory_type: z.enum(['preference', 'convention', 'failure', 'correction', 'decision', 'insight', 'tool_quirk', 'reference', 'handoff']).optional()
      .describe('Memory type (knowledge store). Omit only when using atom_type=task.'),
    atom_type:   z.enum(['memory', 'feedback', 'reference', 'project_note', 'architecture', 'task']).optional()
      .describe('Legacy atom type — use memory_type instead for knowledge; atom_type=task still creates a task atom.'),
    tags:        z.array(z.string()).optional().describe('Tags for searchability'),
    project:     z.string().optional().describe('Project slug (required for project scope). Prefer cwd.'),
    cwd:         z.string().optional().describe('Caller working directory — derives project slug automatically.'),
    confidence:  z.coerce.number().min(0).max(1).optional().describe('Intrinsic confidence 0–1 (default: 0.85)'),
    load_at_init: z.boolean().optional().default(false).describe('If true, always recalled at session start regardless of decay'),
    // Task-specific fields
    status:       z.enum(['ready', 'in_progress', 'blocked', 'done']).optional().describe('Task status (task atoms only, default: ready)'),
    priority:     z.coerce.number().min(1).max(3).optional().describe('Task priority 1-3 (task atoms only, default: 2)'),
    blocks:       z.array(z.string()).optional().describe('Atom IDs this task blocks (task atoms only)'),
    blocked_by:   z.array(z.string()).optional().describe('Atom IDs blocking this task (task atoms only)'),
    discovered_from: z.string().optional().describe('Atom ID of the task that discovered this one (task atoms only)'),
  },
  async ({ title, content, scope, memory_type, atom_type, tags, project, cwd, confidence, load_at_init, status, priority, blocks, blocked_by, discovered_from }) => {
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(cwd) : undefined);
    const isTask = atom_type === 'task';

    // ── Task path (atoms table, file-based) ───────────────────────────
    if (isTask) {
      const claudeDir = join(homedir(), '.claude');
      const targetDir = effectiveProject
        ? join(claudeDir, 'projects', effectiveProject, 'memory')
        : join(claudeDir, 'nexus-atoms');

      if (!existsSync(targetDir)) await mkdir(targetDir, { recursive: true });

      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      let filename = `task_${slug}.md`;
      let filePath = join(targetDir, filename);
      let counter = 2;
      while (existsSync(filePath)) {
        filename = `task_${slug}_${counter}.md`;
        filePath = join(targetDir, filename);
        counter++;
      }

      const now = new Date().toISOString();
      const frontmatterLines = [
        '---',
        `title: "${title}"`,
        `atom_type: task`,
        `status: ${status ?? 'ready'}`,
        `priority: ${priority ?? 2}`,
        effectiveProject ? `project: ${effectiveProject}` : null,
        tags && tags.length > 0 ? `tags: [${tags.map(t => `"${t}"`).join(', ')}]` : `tags: []`,
        `blocks: [${(blocks ?? []).map(b => `"${b}"`).join(', ')}]`,
        `blocked_by: [${(blocked_by ?? []).map(b => `"${b}"`).join(', ')}]`,
        `discovered_from: "${discovered_from ?? ''}"`,
        `created_at: ${now}`,
        `updated_at: ${now}`,
        '---',
      ].filter(Boolean).join('\n');

      await writeFile(filePath, `${frontmatterLines}\n\n${content}`, 'utf-8');
      reindexFile(db, filePath, effectiveProject ? 'memory_file' : 'nexus_native');

      const row = db.prepare(`SELECT id FROM atoms WHERE source_path = ? LIMIT 1`).get(filePath) as { id: string } | undefined;
      return { content: [{ type: 'text', text: `Task created: "${title}"\nID: ${row?.id ?? '(pending index)'}\nPath: ${filePath}` }] };
    }

    // ── Knowledge path (memories table) ───────────────────────────────
    const resolvedMemType: MemoryType =
      memory_type ?? (atom_type ? ATOM_TYPE_TO_MEMORY_TYPE[atom_type] ?? 'insight' : 'insight');

    const { id, inserted } = insertMemory(db, {
      title,
      body: content,
      memory_type: resolvedMemType,
      scope,
      project: effectiveProject ?? null,
      confidence: confidence ?? 0.85,
      decay_class: MEMORY_TYPE_DECAY[resolvedMemType],
      review_status: 'approved',
      source_session_id: null,
      discovered_from: null,
      tags: tags ?? [],
      load_at_init: load_at_init ?? false,
    });

    // Embed in background — best effort, non-blocking for the caller
    embedMemory(db, id).catch(() => {});

    const status_msg = inserted ? 'Memory stored' : 'Memory already exists (content-addressed dedup)';
    return { content: [{ type: 'text', text: `${status_msg}: "${title}"\nID: ${id}\nType: ${resolvedMemType} | Scope: ${scope} | Confidence: ${(confidence ?? 0.85) * 100}%` }] };
  }
);

// ── nexus_tasks_create ───────────────────────────────────────────────

server.tool(
  'nexus_tasks_create',
  'Create multiple task atoms in one call. Accepts an array of task definitions — same fields as nexus_remember with atom_type=task. Returns the ID and path of every created atom.',
  {
    tasks: z.array(z.object({
      title: z.string().describe('Short title for the task'),
      content: z.string().describe('Markdown body / description of the task'),
      project: z.string().optional().describe('Project slug; omit to store in global nexus-atoms/'),
      priority: z.coerce.number().min(1).max(3).optional().describe('Priority 1-3 (default 2)'),
      tags: z.array(z.string()).optional().describe('Tags for searchability'),
      status: z.enum(['ready', 'in_progress', 'blocked', 'done']).optional().describe('Initial status (default: ready)'),
      blocks: z.array(z.string()).optional().describe('Atom IDs this task blocks'),
      blocked_by: z.array(z.string()).optional().describe('Atom IDs that must be done before this task'),
      discovered_from: z.string().optional().describe('Atom ID of the task that discovered this one'),
    })).min(1).describe('Array of task definitions to create'),
  },
  async ({ tasks }) => {
    const claudeDir = join(homedir(), '.claude');
    const now = new Date().toISOString();
    const created: Array<{ title: string; id: string; path: string }> = [];

    for (const t of tasks) {
      const targetDir = t.project
        ? join(claudeDir, 'projects', t.project, 'memory')
        : join(claudeDir, 'nexus-atoms');

      if (!existsSync(targetDir)) {
        await mkdir(targetDir, { recursive: true });
      }

      const slug = t.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      let filename = `task_${slug}.md`;
      let filePath = join(targetDir, filename);
      let counter = 2;
      while (existsSync(filePath)) {
        filename = `task_${slug}_${counter}.md`;
        filePath = join(targetDir, filename);
        counter++;
      }

      const frontmatterLines = [
        '---',
        `title: "${t.title}"`,
        `atom_type: task`,
        `status: ${t.status ?? 'ready'}`,
        `priority: ${t.priority ?? 2}`,
        t.project ? `project: ${t.project}` : null,
        t.tags && t.tags.length > 0 ? `tags: [${t.tags.map(tag => `"${tag}"`).join(', ')}]` : `tags: []`,
        `blocks: [${(t.blocks ?? []).map(b => `"${b}"`).join(', ')}]`,
        `blocked_by: [${(t.blocked_by ?? []).map(b => `"${b}"`).join(', ')}]`,
        `discovered_from: "${t.discovered_from ?? ''}"`,
        `created_at: ${now}`,
        `updated_at: ${now}`,
        '---',
      ].filter(Boolean).join('\n');

      const fileContent = `${frontmatterLines}\n\n${t.content}`;
      await writeFile(filePath, fileContent, 'utf-8');

      reindexFile(db, filePath, t.project ? 'memory_file' : 'nexus_native');

      const row = db.prepare(`SELECT id FROM atoms WHERE source_path = ? LIMIT 1`).get(filePath) as { id: string } | undefined;
      created.push({ title: t.title, id: row?.id ?? '', path: filePath });
    }

    const summary = `Created ${created.length} task${created.length === 1 ? '' : 's'}:\n` +
      created.map(c => `- "${c.title}" → ${c.id} (${c.path})`).join('\n');

    return { content: [{ type: 'text', text: summary }] };
  }
);

// ── Task helpers ────────────────────────────────────────────────────

function resolveEffectiveStatus(
  task: Atom,
  allTasksById: Map<string, Atom>
): TaskStatus {
  // in_progress and done are terminal/active - don't override
  if (task.status === 'done' || task.status === 'in_progress') {
    return task.status as TaskStatus;
  }

  const blockedBy: string[] = JSON.parse(task.blocked_by || '[]');
  for (const depId of blockedBy) {
    const dep = allTasksById.get(depId);
    if (!dep || dep.status !== 'done') return 'blocked';
  }

  return (task.status as TaskStatus) || 'ready';
}

function toTaskAtom(task: Atom, effectiveStatus: TaskStatus): TaskAtom {
  return {
    id: task.id,
    title: task.title,
    status: (task.status as TaskStatus) || 'ready',
    effective_status: effectiveStatus,
    priority: task.priority ?? 2,
    project: task.project ?? '',
    tags: JSON.parse(task.tags as unknown as string || '[]'),
    blocks: JSON.parse(task.blocks || '[]'),
    blocked_by: JSON.parse(task.blocked_by || '[]'),
    discovered_from: task.discovered_from || '',
    created_at: task.created_at,
    summary: task.body.slice(0, 120),
  };
}

// ── nexus_tasks ──────────────────────────────────────────────────────

server.tool(
  'nexus_tasks',
  'List task atoms for the current project by default. Pass cwd or project to scope, or all_projects=true to see all. status="ready" resolves dependency chains.',
  {
    project:      z.string().optional().describe('Explicit project slug filter'),
    cwd:          z.string().optional().describe('Caller working directory — used to derive project slug when project is omitted'),
    all_projects: z.coerce.boolean().optional().describe('Set true to return tasks across all projects (default: false)'),
    status:       z.enum(['ready', 'in_progress', 'blocked', 'done']).optional().describe('Filter by effective status'),
    priority:     z.coerce.number().min(1).max(3).optional().describe('Filter by priority (1-3)'),
    include_done: z.coerce.boolean().optional().describe('Include done tasks (default: false)'),
  },
  async ({ project, cwd, all_projects, status, priority, include_done }) => {
    // Resolve effective project: explicit > cwd-derived > all (if opted in)
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(cwd) : undefined);

    if (!effectiveProject && !all_projects) {
      return { content: [{ type: 'text', text: JSON.stringify({ warning: 'No project context. Pass cwd, project, or all_projects: true.', tasks: [] }) }] };
    }

    // Phase 1: display candidates (filtered)
    let sql = `SELECT * FROM atoms WHERE atom_type = 'task'`;
    const params: unknown[] = [];
    if (effectiveProject) { sql += ` AND project = ?`; params.push(effectiveProject); }
    if (priority)         { sql += ` AND priority = ?`; params.push(priority); }
    const rows = db.prepare(sql).all(...params) as Atom[];

    // Phase 2: full task set for cross-project dependency resolution
    const allRows = db.prepare(`SELECT * FROM atoms WHERE atom_type = 'task'`).all() as Atom[];
    const allTasksById = new Map<string, Atom>(allRows.map(r => [r.id, r]));

    const tasks = rows
      .map(r => ({ task: r, eff: resolveEffectiveStatus(r, allTasksById) }))
      .filter(({ task, eff }) => {
        if (!include_done && (task.status === 'done' || eff === 'done')) return false;
        if (status && eff !== status) return false;
        return true;
      })
      .sort((a, b) => {
        const pa = a.task.priority ?? 2;
        const pb = b.task.priority ?? 2;
        if (pa !== pb) return pa - pb;
        return a.task.created_at.localeCompare(b.task.created_at);
      })
      .map(({ task, eff }) => toTaskAtom(task, eff));

    if (tasks.length === 0) {
      return { content: [{ type: 'text', text: JSON.stringify([]) }] };
    }

    return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
  }
);

// ── nexus_task_update ────────────────────────────────────────────────

server.tool(
  'nexus_task_update',
  'Update a task: change status, edit blocked_by/blocks dependency lists, or file a discovered task.',
  {
    id:         z.string().describe('Atom ID of the task to update'),
    status:     z.enum(['ready', 'in_progress', 'blocked', 'done']).optional().describe('New status'),
    blocked_by: z.array(z.string()).optional().describe('Replace blocked_by list with these atom IDs'),
    blocks:     z.array(z.string()).optional().describe('Replace blocks list with these atom IDs'),
    discovered: z.string().optional().describe('Title of a new task discovered while working on this one'),
  },
  async ({ id, status, blocked_by, blocks, discovered }) => {
    if (!status && !blocked_by && !blocks && !discovered) {
      return { content: [{ type: 'text', text: 'Error: provide at least one of status, blocked_by, blocks, or discovered' }] };
    }

    const task = db.prepare(`SELECT * FROM atoms WHERE id = ? AND atom_type = 'task'`).get(id) as Atom | undefined;
    if (!task) {
      return { content: [{ type: 'text', text: `Error: task not found with id ${id}` }] };
    }

    const now = new Date().toISOString();

    // Read and parse the file
    const fileContent = await readFile(task.source_path, 'utf-8');
    const parsed = matter(fileContent);

    // Update only the fields that were provided
    if (status)     { parsed.data.status = status; }
    if (blocked_by) { parsed.data.blocked_by = blocked_by; }
    if (blocks)     { parsed.data.blocks = blocks; }
    parsed.data.updated_at = now;

    // Serialize back
    const newContent = matter.stringify(parsed.content, parsed.data);
    await writeFile(task.source_path, newContent, 'utf-8');

    // Update DB directly so changes are immediately visible.
    // reindexFile alone is insufficient because the unchanged-hash check skips
    // upserts when only frontmatter changed.
    const sets: string[] = ['updated_at = ?'];
    const dbParams: unknown[] = [now];
    if (status)     { sets.unshift('status = ?');  dbParams.unshift(status); }
    if (blocked_by) { sets.push('blocked_by = ?'); dbParams.push(JSON.stringify(blocked_by)); }
    if (blocks)     { sets.push('blocks = ?');     dbParams.push(JSON.stringify(blocks)); }
    dbParams.push(id);
    db.prepare(`UPDATE atoms SET ${sets.join(', ')} WHERE id = ?`).run(...dbParams);

    // Full re-index to update content_hash so the next periodic scan is accurate
    reindexFile(db, task.source_path, task.source_type as any);

    // Fetch updated task
    const updated = db.prepare(`SELECT * FROM atoms WHERE id = ?`).get(id) as Atom;
    const allTasks = db.prepare(`SELECT * FROM atoms WHERE atom_type = 'task'`).all() as Atom[];
    const allTasksById = new Map<string, Atom>(allTasks.map(r => [r.id, r]));
    const updatedAtom = toTaskAtom(updated, resolveEffectiveStatus(updated, allTasksById));

    // Optionally create a discovered task
    let discoveredId: string | undefined;
    if (discovered) {
      const claudeDir = join(homedir(), '.claude');
      const targetDir = task.project
        ? join(claudeDir, 'projects', task.project, 'memory')
        : join(claudeDir, 'nexus-atoms');

      if (!existsSync(targetDir)) {
        await mkdir(targetDir, { recursive: true });
      }

      const slug = discovered.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      let filename = `task_${slug}.md`;
      let filePath = join(targetDir, filename);
      let counter = 2;
      while (existsSync(filePath)) {
        filename = `task_${slug}_${counter}.md`;
        filePath = join(targetDir, filename);
        counter++;
      }

      const discoveredContent = [
        '---',
        `title: "${discovered}"`,
        `atom_type: task`,
        `status: ready`,
        `priority: 2`,
        task.project ? `project: ${task.project}` : null,
        `tags: []`,
        `blocks: []`,
        `blocked_by: []`,
        `discovered_from: "${id}"`,
        `created_at: ${now}`,
        `updated_at: ${now}`,
        '---',
        '',
        `Discovered while working on: ${task.title}`,
      ].filter(Boolean).join('\n');

      await writeFile(filePath, discoveredContent, 'utf-8');
      reindexFile(db, filePath, task.source_type as any);

      const newTask = db.prepare(`SELECT id FROM atoms WHERE source_path = ? LIMIT 1`).get(filePath) as { id: string } | undefined;
      discoveredId = newTask?.id;
    }

    const result: Record<string, unknown> = { updated: updatedAtom };
    if (discoveredId) result.discovered_task_id = discoveredId;

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── nexus_stats ──────────────────────────────────────────────────────

server.tool(
  'nexus_stats',
  'Get database statistics: atom counts by type/scope/project, link counts, session counts.',
  {},
  async () => {
    const stats = getStats(db);

    const reviewSummary = Object.entries(stats.memoriesByReview).map(([s, c]) => `${s}(${c})`).join(', ') || 'none';

    const text = `# Nexus Stats

**Total Atoms:** ${stats.totalAtoms} (${stats.embeddedAtoms} embedded)
**By Type:** ${Object.entries(stats.atomsByType).map(([t, c]) => `${t}(${c})`).join(', ')}
**By Scope:** ${Object.entries(stats.atomsByScope).map(([s, c]) => `${s}(${c})`).join(', ')}
**By Project:** ${Object.entries(stats.atomsByProject).map(([p, c]) => `${p}(${c})`).join(', ')}
**Memories:** ${stats.totalMemories} (${stats.embeddedMemories} embedded) — review: ${reviewSummary}
**Links:** ${stats.totalLinks}
**Sessions:** ${stats.totalSessions}
**Diagnostics:** ${stats.totalDiagnostics}`;

    return { content: [{ type: 'text', text }] };
  }
);

// ── nexus_verify ─────────────────────────────────────────────────────

server.tool(
  'nexus_verify',
  'Reconfirm a memory is still accurate. Resets its decay clock and nudges confidence up — use after checking a decayed or stale memory still holds.',
  {
    id: z.string().describe('Memory id (from the dashboard or nexus_health diagnostics)'),
  },
  async ({ id }) => {
    const ok = verifyMemory(db, id);
    return { content: [{ type: 'text', text: ok ? `Memory ${id} reverified — decay clock reset.` : `Error: memory not found: ${id}` }] };
  }
);

// ── nexus_feedback ───────────────────────────────────────────────────

server.tool(
  'nexus_feedback',
  'Record whether a recalled memory was actually useful. Feeds the help-rate term in recall ranking so memories that help surface more often.',
  {
    id:     z.string().describe('Memory id'),
    helped: z.boolean().describe('true if the memory was useful this session, false if not'),
  },
  async ({ id, helped }) => {
    const ok = recordFeedback(db, id, helped);
    return { content: [{ type: 'text', text: ok ? `Feedback recorded for ${id} (helped=${helped}).` : `Error: memory not found: ${id}` }] };
  }
);

// ── nexus_consolidate ────────────────────────────────────────────────

server.tool(
  'nexus_consolidate',
  'Run a memory cleanup sweep: backfill missing embeddings, prune rejected memories, and merge near-duplicates. Safe — decayed memories are never deleted, only superseded duplicates and rejected memories.',
  {},
  async () => {
    const r = await consolidateMemories(db);
    return {
      content: [{
        type: 'text',
        text: `Consolidation complete: ${r.embedded} embedded, ${r.merged} duplicate(s) merged, ${r.pruned} rejected pruned.`,
      }],
    };
  }
);

// ── nexus_distill ────────────────────────────────────────────────────

server.tool(
  'nexus_distill',
  'Deep cleanup of existing memories: clusters related memories and rewrites each cluster into one tighter, non-redundant memory; tightens verbose ones. Use to clean up legacy or hand-written memories. Heavier than nexus_consolidate — it makes LLM rewrite calls.',
  {},
  async () => {
    const r = await distillMemories(db);
    return {
      content: [{
        type: 'text',
        text: `Distill complete: ${r.clusters} cluster(s) → ${r.created} consolidated memories (${r.merged} folded in), ${r.sanitized} tightened, ${r.embedded} embedded.`,
      }],
    };
  }
);

// ── nexus_backfill ───────────────────────────────────────────────────

server.tool(
  'nexus_backfill',
  'Retroactively extract memories from past sessions that predate the capture hooks. Bounded — processes recent un-analyzed sessions for a project. For a full backfill across all history, use the `nexus backfill` CLI command.',
  {
    project: z.string().optional().describe('Project slug. Prefer cwd to avoid guessing the slug.'),
    cwd:     z.string().optional().describe('Working directory — derives the project slug automatically.'),
    limit:   z.coerce.number().optional().describe('Max sessions to process (capped at 30)'),
    dry_run: z.boolean().optional().describe('Report how many sessions would be processed, run nothing'),
  },
  async ({ project, cwd, limit, dry_run }) => {
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(cwd) : undefined);
    const r = await backfillSessions(db, {
      project: effectiveProject,
      limit: Math.min(limit ?? 10, 30),
      dryRun: dry_run,
    });
    const text = r.dryRun
      ? `${r.selected} session(s) would be backfilled.`
      : `Backfill: ${r.processed}/${r.selected} sessions processed — ${r.inserted} memories created, ${r.merged} merged, ${r.skippedNoSignal} had nothing durable.`;
    return { content: [{ type: 'text', text }] };
  }
);

// ── nexus_reindex ───────────────────────────────────────────────────

server.tool(
  'nexus_reindex',
  'Force a full re-index of all Claude knowledge files. Call after saving new memory files via the Write tool, or if search results seem stale.',
  {},
  async () => {
    const stats = await runFullIndex(db);

    return {
      content: [{
        type: 'text',
        text: `Re-index complete: ${stats.atomsCreated} created, ${stats.atomsUpdated} updated, ${stats.atomsUnchanged} unchanged, ${stats.linksCreated} links, ${stats.sessionsIndexed} sessions.`,
      }],
    };
  }
);

// ── nexus_crossref ───────────────────────────────────────────────────

server.tool(
  'nexus_crossref',
  'Hybrid cross-reference search: merges dense (vector) and sparse (BM25) retrieval via RRF. Annotates each result with its link_type from atom_links when available. Use to discover semantically related atoms you didn\'t know to search for directly.',
  {
    query:   z.string().describe('Search query'),
    project: z.string().optional().describe('Filter by project slug'),
    cwd:     z.string().optional().describe('Caller working directory — derives project slug automatically'),
    limit:   z.coerce.number().optional().describe('Max results to return (default 10)'),
  },
  async ({ query, project, cwd, limit }) => {
    const cap = limit ?? 10;
    const knnLimit = cap * 2;

    // Dense KNN over atoms_vec
    const denseResults: RankedResult[] = [];
    try {
      const vec = await generateEmbedding(query);
      if (vec) {
        const { vecToBlob, normalize } = await import('../core/memories.js');
        const blob = vecToBlob(normalize(vec));
        const knnRows = db.prepare(
          `SELECT a.id, av.distance FROM atoms_vec av
           JOIN atoms a ON a.rowid = av.rowid
           WHERE av.embedding MATCH ?
           ORDER BY av.distance
           LIMIT ?`
        ).all(blob, knnLimit) as { id: string; distance: number }[];
        for (const r of knnRows) {
          const sim = Math.max(0, 1 - (r.distance * r.distance) / 2);
          denseResults.push({ id: r.id, score: sim });
        }
      }
    } catch {
      // atoms_vec unavailable — BM25-only fallback
    }

    // BM25
    const bm25Results: RankedResult[] = [];
    try {
      const allAtoms = db.prepare(`SELECT id, title, body FROM atoms`).all() as { id: string; title: string; body: string }[];
      if (allAtoms.length >= 3) {
        const corpus = buildBm25Corpus(allAtoms);
        const raw = corpus.search(query, knnLimit);
        for (const [ref, score] of raw) {
          bm25Results.push({ id: ref, score });
        }
      }
    } catch {
      // BM25 failed
    }

    // RRF merge
    const merged = rrfMerge(bm25Results, denseResults, cap);
    if (merged.length === 0) {
      return { content: [{ type: 'text', text: 'No cross-references found.' }] };
    }

    // Normalize scores to [0, 1]
    const maxScore = merged[0].score || 1;
    const normalized = merged.map(r => ({ ...r, score: r.score / maxScore }));

    // Project filter
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(cwd) : undefined);

    const parts: string[] = ['# Cross-References\n'];

    for (const r of normalized) {
      // Fetch atom details
      let atomRow: { id: string; title: string; atom_type: string; body: string; project: string | null } | undefined;
      try {
        atomRow = db.prepare(
          `SELECT id, title, atom_type, body, project FROM atoms WHERE id = ?`
        ).get(r.id) as typeof atomRow;
      } catch { continue; }
      if (!atomRow) continue;
      if (effectiveProject && atomRow.project !== effectiveProject) continue;

      // Look up link_type from atom_links
      let linkType: LinkType | null = null;
      try {
        const linkRow = db.prepare(
          `SELECT link_type FROM atom_links WHERE source_id = ? LIMIT 1`
        ).get(r.id) as { link_type: LinkType } | undefined;
        linkType = linkRow?.link_type ?? null;
      } catch {}

      const badge = linkType ? ` [${linkType}]` : '';
      const snippet = atomRow.body.slice(0, 300).replace(/\n/g, ' ');

      parts.push(
        `### ${atomRow.title}${badge}\n_${atomRow.atom_type} | score: ${r.score.toFixed(2)}_\n\n${snippet}`
      );
    }

    if (parts.length === 1) {
      return { content: [{ type: 'text', text: 'No cross-references found.' }] };
    }

    return { content: [{ type: 'text', text: parts.join('\n\n') }] };
  }
);

// ── Start server ─────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
