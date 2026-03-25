import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { openDatabase, initializeSchema } from '../core/database.js';
import { runFullIndex } from '../indexer/indexer.js';
import {
  search,
  fetchContext,
  getSharedKnowledge,
  getProjectContext,
  listSessions,
  getDiagnostics,
  getStats,
  listAtoms,
} from '../core/search.js';

// Initialize database and index on startup
const db = openDatabase();
initializeSchema(db);
runFullIndex(db);

const server = new McpServer({
  name: 'claude-nexus',
  version: '0.1.0',
});

// ── nexus_search ─────────────────────────────────────────────────────

server.tool(
  'nexus_search',
  'Cross-project full-text search across all Claude knowledge (memories, agents, skills, plans). Returns relevant atoms merged into one markdown response.',
  {
    query: z.string().describe('Search query (supports FTS5 syntax: AND, OR, NOT, "phrases", prefix*)'),
    project: z.string().optional().describe('Filter by project slug'),
    type: z.string().optional().describe('Filter by atom type: memory, agent, skill, plan, feedback, reference, project_note'),
    scope: z.string().optional().describe('Filter by scope: global, shared, project'),
    limit: z.number().optional().describe('Max results (default: 10)'),
  },
  async ({ query, project, type, scope, limit }) => {
    const results = search(db, query, { project, type, scope, limit: limit ?? 10 });

    if (results.length === 0) {
      return { content: [{ type: 'text', text: 'No results found.' }] };
    }

    const parts = results.map(r => {
      const scopeBadge = r.atom.scope === 'global' ? '[GLOBAL]' : r.atom.scope === 'shared' ? '[SHARED]' : '';
      const source = r.atom.project || 'global';
      return `## ${r.atom.title} ${scopeBadge}\n_Source: ${source} | ${r.atom.atom_type}_\n\n${r.atom.body}`;
    });

    return {
      content: [{ type: 'text', text: parts.join('\n\n---\n\n') }],
    };
  }
);

// ── nexus_context ────────────────────────────────────────────────────

server.tool(
  'nexus_context',
  'Smart fetch: request multiple topics and receive one merged response with all relevant knowledge. Use this instead of reading multiple files — one tool call, precisely targeted context.',
  {
    topics: z.array(z.string()).describe('List of topics to fetch (e.g., ["ECS architecture", "coding preferences", "WebGL bridge"])'),
    project: z.string().optional().describe('Optionally scope to a specific project'),
  },
  async ({ topics, project }) => {
    const merged = fetchContext(db, topics, { project });

    if (!merged) {
      return { content: [{ type: 'text', text: 'No atoms found for the given topics.' }] };
    }

    return { content: [{ type: 'text', text: merged }] };
  }
);

// ── nexus_shared ─────────────────────────────────────────────────────

server.tool(
  'nexus_shared',
  'Get all shared/global knowledge atoms (user preferences, environment info, cross-project patterns). Call at session start for universal context.',
  {},
  async () => {
    const merged = getSharedKnowledge(db);

    if (!merged) {
      return { content: [{ type: 'text', text: 'No shared knowledge atoms found.' }] };
    }

    return { content: [{ type: 'text', text: merged }] };
  }
);

// ── nexus_project ────────────────────────────────────────────────────

server.tool(
  'nexus_project',
  'Get all knowledge atoms for a specific project. Returns project memories, notes, and architecture docs merged into one response.',
  {
    project: z.string().describe('Project slug (e.g., "C--Fran-RRDestructible")'),
  },
  async ({ project }) => {
    const merged = getProjectContext(db, project);

    if (!merged) {
      return { content: [{ type: 'text', text: `No atoms found for project: ${project}` }] };
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

server.tool(
  'nexus_remember',
  'Store a new knowledge atom in the zettelkasten. Use this to proactively save insights, decisions, or patterns that should persist across sessions.',
  {
    title: z.string().describe('Short title for the knowledge atom'),
    content: z.string().describe('Markdown content of the atom'),
    scope: z.enum(['global', 'shared', 'project']).describe('Scope: global (all projects), shared (related projects), project (current only)'),
    atom_type: z.enum(['memory', 'feedback', 'reference', 'project_note', 'architecture']).describe('Type of knowledge'),
    tags: z.array(z.string()).optional().describe('Tags for searchability'),
    project: z.string().optional().describe('Project slug (required for project scope)'),
  },
  async ({ title, content, scope, atom_type, tags, project }) => {
    const { createHash } = await import('crypto');
    const { writeFileSync, mkdirSync, existsSync } = await import('fs');
    const { join } = await import('path');
    const { homedir } = await import('os');
    const { computeAtomId, computeHash } = await import('../indexer/parser.js');

    // Determine where to store the file
    const claudeDir = join(homedir(), '.claude');
    let targetDir: string;
    let filename: string;

    if (scope === 'global' || !project) {
      // Store in a nexus-specific directory
      targetDir = join(claudeDir, 'nexus-atoms');
    } else {
      targetDir = join(claudeDir, 'projects', project, 'memory');
    }

    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // Generate filename from title
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    filename = `${atom_type}_${slug}.md`;
    const filePath = join(targetDir, filename);

    // Write markdown file with frontmatter
    const frontmatter = [
      '---',
      `name: "${title}"`,
      `type: ${atom_type}`,
      `scope: ${scope}`,
      tags && tags.length > 0 ? `tags: [${tags.map(t => `"${t}"`).join(', ')}]` : null,
      '---',
    ].filter(Boolean).join('\n');

    writeFileSync(filePath, `${frontmatter}\n\n${content}`, 'utf-8');

    // Index the new file
    const { reindexFile } = await import('../indexer/indexer.js');
    reindexFile(db, filePath, scope === 'global' ? 'nexus_native' : 'memory_file');

    return {
      content: [{ type: 'text', text: `Atom created: "${title}" at ${filePath}` }],
    };
  }
);

// ── nexus_stats ──────────────────────────────────────────────────────

server.tool(
  'nexus_stats',
  'Get database statistics: atom counts by type/scope/project, link counts, session counts.',
  {},
  async () => {
    const stats = getStats(db);

    const text = `# Nexus Stats

**Total Atoms:** ${stats.totalAtoms}
**By Type:** ${Object.entries(stats.atomsByType).map(([t, c]) => `${t}(${c})`).join(', ')}
**By Scope:** ${Object.entries(stats.atomsByScope).map(([s, c]) => `${s}(${c})`).join(', ')}
**By Project:** ${Object.entries(stats.atomsByProject).map(([p, c]) => `${p}(${c})`).join(', ')}
**Links:** ${stats.totalLinks}
**Sessions:** ${stats.totalSessions}
**Diagnostics:** ${stats.totalDiagnostics}`;

    return { content: [{ type: 'text', text }] };
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
