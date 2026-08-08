import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { writeFile, readFile } from 'fs/promises';
import matter from 'gray-matter';
import { openDatabase, initializeSchema } from '../core/database.js';
import { runFullIndex } from '../indexer/indexer.js';
import { resolveProjectFromCwd } from '../core/project-root.js';
import { buildBm25Corpus, rrfMerge } from '../core/links.js';
import { generateEmbedding } from '../core/embeddings.js';
import { extractIdentifiers, unionIdentifiers } from '../core/identifiers.js';
import { hybridSearch, hybridSearchMemories, fetchContext, fetchMemoryContext, getSharedKnowledge, getProjectContext, listSessions, getDiagnostics, getStats, } from '../core/search.js';
import { recallMemories } from '../core/recall.js';
import { verifyMemory, recordFeedback, insertMemory, embedMemory, rememberBatch, getMemory } from '../core/memories.js';
import { consolidateMemories } from '../core/consolidate.js';
import { distillMemories } from '../core/distill.js';
import { backfillSessions } from '../capture/backfill.js';
// Initialize database and index on startup
const db = openDatabase();
initializeSchema(db);
// NOTE: the MCP server intentionally does NOT run a full index on startup.
// runFullIndex executes large *synchronous* better-sqlite3 transactions that block the
// single event-loop thread for tens of seconds on a large DB — long past the client's
// connect timeout, so the `initialize` handshake never lands and the client reports
// "Failed to connect". It also contends the DB write lock (SQLITE_BUSY).
// Indexing is owned by the web/api server (src/web/server.ts: startup + periodic + watcher).
// This server writes memories directly via insertMemory, and exposes an on-demand
// full-index tool for manual refresh.
const server = new McpServer({
    name: 'claude-nexus',
    version: '0.1.0',
});
// ── nexus_search ─────────────────────────────────────────────────────
server.tool('nexus_search', 'Cross-project full-text search across all Claude knowledge: captured memories AND agents/skills/plans/notes. Returns both stores merged into one markdown response.', {
    query: z.string().describe('Search query (supports FTS5 syntax: AND, OR, NOT, "phrases", prefix*)'),
    project: z.string().optional().describe('Filter by full project slug (e.g. "C--Fran-Monster-Hotel"). Prefer cwd to avoid guessing the slug.'),
    cwd: z.string().optional().describe('Caller working directory — derives the project slug automatically. Use instead of project when searching within the current project.'),
    type: z.string().optional().describe('Filter atoms by type: agent, skill, plan, task, project_note, architecture (omit to include all)'),
    scope: z.string().optional().describe('Filter by scope: global, shared, project'),
    limit: z.coerce.number().optional().describe('Max results per store (default: 10)'),
}, async ({ query, project, cwd, type, scope, limit }) => {
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(db, cwd) : undefined);
    const cap = limit ?? 10;
    const [atomResults, memResults] = await Promise.all([
        hybridSearch(db, query, { project: effectiveProject, type, scope, limit: cap }),
        hybridSearchMemories(db, query, { project: effectiveProject, scope, limit: cap }),
    ]);
    if (atomResults.length === 0 && memResults.length === 0) {
        return { content: [{ type: 'text', text: 'No results found.' }] };
    }
    const parts = [];
    if (memResults.length > 0) {
        parts.push('## Captured Memories');
        for (const r of memResults) {
            const badge = r.memory.scope === 'global' ? ' [GLOBAL]' : r.memory.scope === 'shared' ? ' [SHARED]' : '';
            const conf = (r.memory.confidence * 100).toFixed(0);
            parts.push(`### [${r.memory.memory_type}] ${r.memory.title}${badge}\n_Confidence: ${conf}% | ${r.memory.decay_class}_\n\n${r.memory.body}`);
        }
    }
    if (atomResults.length > 0) {
        if (parts.length > 0)
            parts.push('---');
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
});
// ── nexus_context ────────────────────────────────────────────────────
server.tool('nexus_context', 'Smart fetch: request multiple topics and receive one merged response with all relevant knowledge from both captured memories and knowledge atoms. One tool call, precisely targeted context.', {
    topics: z.array(z.string()).describe('List of topics to fetch (e.g., ["ECS architecture", "coding preferences", "WebGL bridge"])'),
    project: z.string().optional().describe('Scope to a full project slug (e.g. "C--Fran-Monster-Hotel"). Prefer cwd to avoid guessing the slug.'),
    cwd: z.string().optional().describe('Caller working directory — derives the project slug automatically. Use instead of project when scoping to the current project.'),
}, async ({ topics, project, cwd }) => {
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(db, cwd) : undefined);
    const memMerged = fetchMemoryContext(db, topics, { project: effectiveProject });
    const atomMerged = fetchContext(db, topics, { project: effectiveProject });
    if (!memMerged && !atomMerged) {
        return { content: [{ type: 'text', text: 'No knowledge found for the given topics.' }] };
    }
    const parts = [];
    if (memMerged)
        parts.push(memMerged);
    if (atomMerged)
        parts.push(atomMerged);
    return { content: [{ type: 'text', text: parts.join('\n\n---\n\n') }] };
});
// ── nexus_recall ─────────────────────────────────────────────────────
server.tool('nexus_recall', 'Recall the most relevant memories for the current project, budgeted to a token cap. With no query, returns session-start context (preferences, conventions, decisions, handoffs). With a query, restricts to memories matching that topic. Ranked by confidence, recency, and helpfulness; full bodies until the budget is reached, then titles only.', {
    project: z.string().optional().describe('Full project slug. Prefer cwd to avoid guessing the slug.'),
    cwd: z.string().optional().describe('Caller working directory — derives the project slug automatically.'),
    query: z.string().optional().describe('Optional topic to focus recall on. Omit for general session-start recall.'),
    max_tokens: z.coerce.number().optional().describe('Token budget for injected memory (default from extraction_models.yaml).'),
}, async ({ project, cwd, query, max_tokens }) => {
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(db, cwd) : null);
    const result = recallMemories(db, { project: effectiveProject, query, maxTokens: max_tokens });
    if (result.items.length === 0) {
        return { content: [{ type: 'text', text: 'No memories recalled.' }] };
    }
    return { content: [{ type: 'text', text: result.markdown }] };
});
// ── nexus_shared ─────────────────────────────────────────────────────
server.tool('nexus_shared', 'Get global/shared knowledge for session start. Returns full content for atoms flagged load_at_init=true, plus a compact titles-only index of all other global/shared atoms. Use nexus_set_init to flag atoms for full loading.', {}, async () => {
    const merged = getSharedKnowledge(db);
    if (!merged) {
        return { content: [{ type: 'text', text: 'No shared knowledge atoms found.' }] };
    }
    return { content: [{ type: 'text', text: merged }] };
});
// ── nexus_set_init ───────────────────────────────────────────────────
server.tool('nexus_set_init', 'Toggle the load_at_init flag on a global or shared atom. When true, nexus_shared returns that atom\'s full content at session start. Use nexus_search to find atom IDs.', {
    id: z.string().describe('Atom ID to update'),
    load_at_init: z.boolean().describe('true = load full content at session start; false = titles-only index'),
}, async ({ id, load_at_init }) => {
    const atom = db.prepare(`SELECT * FROM atoms WHERE id = ?`).get(id);
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
});
// ── nexus_project ────────────────────────────────────────────────────
server.tool('nexus_project', 'Get all knowledge atoms for a specific project. Returns project memories, notes, and architecture docs merged into one response.', {
    project: z.string().optional().describe('Full project slug (e.g. "C--Fran-RRDestructible"). Prefer cwd to avoid guessing the slug.'),
    cwd: z.string().optional().describe('Caller working directory — derives the project slug automatically.'),
}, async ({ project, cwd }) => {
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(db, cwd) : undefined);
    if (!effectiveProject) {
        return { content: [{ type: 'text', text: 'Error: provide project or cwd.' }] };
    }
    const merged = getProjectContext(db, effectiveProject);
    if (!merged) {
        return { content: [{ type: 'text', text: `No atoms found for project: ${effectiveProject}` }] };
    }
    return { content: [{ type: 'text', text: merged }] };
});
// ── nexus_sessions ───────────────────────────────────────────────────
server.tool('nexus_sessions', 'List Claude Code sessions with their status, project, branch, and message counts.', {
    project: z.string().optional().describe('Filter by project slug'),
    status: z.string().optional().describe('Filter by status: active, waiting_input, processing, idle, dead'),
}, async ({ project, status }) => {
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
});
// ── nexus_health ─────────────────────────────────────────────────────
server.tool('nexus_health', 'Show diagnostics: broken references, duplicates, orphan atoms, missing frontmatter. Use to audit knowledge graph health.', {
    type: z.string().optional().describe('Filter: broken_reference, missing_frontmatter, duplicate, orphan, stale'),
}, async ({ type }) => {
    const diags = getDiagnostics(db, type);
    const stats = getStats(db);
    const summary = `# Nexus Health Report

**Atoms:** ${stats.totalAtoms} | **Links:** ${stats.totalLinks} | **Sessions:** ${stats.totalSessions}
**Issues:** ${stats.totalDiagnostics}

${Object.entries(stats.diagnosticsByType).map(([t, c]) => `- ${t}: ${c}`).join('\n')}

## Details

${diags.map(d => `- **[${d.type}]** ${d.message}${d.details ? `\n  ${d.details}` : ''}`).join('\n')}`;
    return { content: [{ type: 'text', text: summary }] };
});
// ── nexus_remember ───────────────────────────────────────────────────
// Maps legacy atom_type values to memory_type for the memories store.
const ATOM_TYPE_TO_MEMORY_TYPE = {
    memory: 'insight',
    feedback: 'correction',
    reference: 'reference',
    project_note: 'decision',
    architecture: 'decision',
};
// Default decay class per memory type.
const MEMORY_TYPE_DECAY = {
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
server.tool('nexus_remember', 'Store knowledge in the memories store — writes to the memories table so it is searchable by nexus_search and recallable by nexus_recall.', {
    title: z.string().describe('Short title for the memory'),
    content: z.string().describe('Body — 1–4 self-contained sentences with the durable lesson and its why'),
    scope: z.enum(['global', 'shared', 'project']).describe('Scope: global (all projects), shared (related projects), project (current only)'),
    memory_type: z.enum(['preference', 'convention', 'failure', 'correction', 'decision', 'insight', 'tool_quirk', 'reference', 'handoff']).optional()
        .describe('Memory type (knowledge store).'),
    atom_type: z.enum(['memory', 'feedback', 'reference', 'project_note', 'architecture']).optional()
        .describe('Legacy atom type — use memory_type instead for knowledge.'),
    tags: z.array(z.string()).optional().describe('Tags for searchability'),
    project: z.string().optional().describe('Project slug (required for project scope). Prefer cwd.'),
    cwd: z.string().optional().describe('Caller working directory — derives project slug automatically.'),
    confidence: z.coerce.number().min(0).max(1).optional().describe('Intrinsic confidence 0–1 (default: 0.85)'),
    load_at_init: z.boolean().optional().default(false).describe('If true, always recalled at session start regardless of decay'),
}, async ({ title, content, scope, memory_type, atom_type, tags, project, cwd, confidence, load_at_init }) => {
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(db, cwd) : undefined);
    // ── Knowledge path (memories table) ───────────────────────────────
    const resolvedMemType = memory_type ?? (atom_type ? ATOM_TYPE_TO_MEMORY_TYPE[atom_type] ?? 'insight' : 'insight');
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
        promotion_target: 'none',
        load_at_init: load_at_init ?? false,
    });
    // Embed in background — best effort, non-blocking for the caller
    embedMemory(db, id).catch(() => { });
    const status_msg = inserted ? 'Memory stored' : 'Memory already exists (content-addressed dedup)';
    return { content: [{ type: 'text', text: `${status_msg}: "${title}"\nID: ${id}\nType: ${resolvedMemType} | Scope: ${scope} | Confidence: ${(confidence ?? 0.85) * 100}%` }] };
});
// ── nexus_remember_batch ─────────────────────────────────────────────
server.tool('nexus_remember_batch', 'Store MANY memories in ONE call — batch equivalent of nexus_remember for bulk pointer emission (e.g. a set of recipe/best-practice pointers). Each item may set its own fields; top-level fields act as defaults when an item omits them (effective = item ?? default ?? builtin). Best-effort: a failed item is reported, not fatal — the on-disk doc file is authoritative.', {
    memories: z.array(z.object({
        title: z.string().describe('Short title for the memory'),
        content: z.string().describe('Body — 1–4 self-contained sentences with the durable lesson and its why'),
        scope: z.enum(['global', 'shared', 'project']).optional().describe('Overrides the top-level scope default for this item'),
        memory_type: z.enum(['preference', 'convention', 'failure', 'correction', 'decision', 'insight', 'tool_quirk', 'reference', 'handoff']).optional().describe('Overrides the top-level memory_type default'),
        tags: z.array(z.string()).optional().describe('Tags — overrides the top-level tags default'),
        confidence: z.coerce.number().min(0).max(1).optional().describe('Intrinsic confidence 0–1 — overrides the top-level default'),
        load_at_init: z.boolean().optional().describe('Overrides the top-level load_at_init default'),
        project: z.string().optional().describe('Project slug — overrides the top-level/cwd-derived project for this item'),
    })).min(1).max(50).describe('1–50 memories to write in one transaction'),
    // Top-level defaults applied to any item that omits the field.
    scope: z.enum(['global', 'shared', 'project']).optional().describe('Default scope for all items (default: project)'),
    memory_type: z.enum(['preference', 'convention', 'failure', 'correction', 'decision', 'insight', 'tool_quirk', 'reference', 'handoff']).optional().describe('Default memory_type for all items (default: insight)'),
    tags: z.array(z.string()).optional().describe('Default tags for all items'),
    confidence: z.coerce.number().min(0).max(1).optional().describe('Default confidence for all items (default: 0.85)'),
    load_at_init: z.boolean().optional().describe('Default load_at_init for all items (default: false)'),
    project: z.string().optional().describe('Default project slug (prefer cwd)'),
    cwd: z.string().optional().describe('Caller working directory — derives the default project slug automatically'),
}, async ({ memories, scope, memory_type, tags, confidence, load_at_init, project, cwd }) => {
    const defaultProject = project ?? (cwd ? resolveProjectFromCwd(db, cwd) : undefined);
    const items = memories.map((m) => {
        const resolvedMemType = m.memory_type ?? memory_type ?? 'insight';
        const effProject = m.project ?? defaultProject ?? null;
        return {
            title: m.title,
            body: m.content,
            memory_type: resolvedMemType,
            scope: (m.scope ?? scope ?? 'project'),
            project: effProject,
            confidence: m.confidence ?? confidence ?? 0.85,
            decay_class: MEMORY_TYPE_DECAY[resolvedMemType],
            review_status: 'approved',
            source_session_id: null,
            discovered_from: null,
            tags: m.tags ?? tags ?? [],
            promotion_target: 'none',
            load_at_init: m.load_at_init ?? load_at_init ?? false,
        };
    });
    const { results } = await rememberBatch(db, items);
    const written = results.filter(r => r.status === 'written').length;
    const duplicates = results.filter(r => r.status === 'duplicate').length;
    const errors = results.filter(r => r.status === 'error').length;
    const lines = results.map((r) => {
        const label = memories[r.index].title;
        if (r.status === 'error')
            return `  [${r.index}] ERROR: ${label} — ${r.reason}`;
        return `  [${r.index}] ${r.status}: ${label} (${r.id})`;
    });
    return { content: [{ type: 'text', text: `Batch: ${written} written, ${duplicates} duplicates, ${errors} errors\n${lines.join('\n')}` }] };
});
// ── nexus_stats ──────────────────────────────────────────────────────
server.tool('nexus_stats', 'Get database statistics: atom counts by type/scope/project, link counts, session counts.', {}, async () => {
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
});
// ── nexus_verify ─────────────────────────────────────────────────────
server.tool('nexus_verify', 'Reconfirm a memory is still accurate. Resets its decay clock and nudges confidence up — use after checking a decayed or stale memory still holds.', {
    id: z.string().describe('Memory id (from the dashboard or nexus_health diagnostics)'),
}, async ({ id }) => {
    const ok = verifyMemory(db, id);
    return { content: [{ type: 'text', text: ok ? `Memory ${id} reverified — decay clock reset.` : `Error: memory not found: ${id}` }] };
});
// ── nexus_feedback ───────────────────────────────────────────────────
server.tool('nexus_feedback', 'Record whether a recalled memory was actually useful. Feeds the help-rate term in recall ranking so memories that help surface more often.', {
    id: z.string().describe('Memory id'),
    helped: z.boolean().describe('true if the memory was useful this session, false if not'),
}, async ({ id, helped }) => {
    const ok = recordFeedback(db, id, helped);
    return { content: [{ type: 'text', text: ok ? `Feedback recorded for ${id} (helped=${helped}).` : `Error: memory not found: ${id}` }] };
});
// ── nexus_consolidate ────────────────────────────────────────────────
server.tool('nexus_consolidate', 'Run a memory cleanup sweep: backfill missing embeddings, prune rejected memories, merge near-duplicates, govern confidence by help-rate trend, and surface candidate contradictions. Safe — decayed memories are never deleted, only superseded duplicates and rejected memories.', {}, async () => {
    const r = await consolidateMemories(db);
    return {
        content: [{
                type: 'text',
                text: `Consolidation complete: ${r.embedded} embedded, ${r.merged} merged, ${r.pruned} pruned, ${r.demoted} demoted, ${r.reinforced} reinforced, ${r.contradictionPairsChecked} contradiction pair(s) checked (${r.contradictionsFlagged} flagged).`,
            }],
    };
});
// ── nexus_distill ────────────────────────────────────────────────────
server.tool('nexus_distill', 'Deep cleanup of existing memories: clusters related memories and rewrites each cluster into one tighter, non-redundant memory; tightens verbose ones. Use to clean up legacy or hand-written memories. Heavier than nexus_consolidate — it makes LLM rewrite calls. Bounded and scopable — processes a capped candidate pool for a project, the global bucket, or everything, with an optional dry run. Runs advance a persistent cursor, so re-invoking sweeps the NEXT chunk; loop until eligibleRemaining is 0. A run finding 0 clusters is normal mid-sweep and is NOT a stop signal.', {
    project: z.string().optional().describe('Project slug to scope to. Prefer cwd to avoid guessing the slug. Literal "global" targets the global bucket.'),
    cwd: z.string().optional().describe('Caller working directory — derives the project slug automatically.'),
    limit: z.coerce.number().optional().describe('Max candidate memories to process this run (default 200, capped at 500)'),
    dry_run: z.boolean().optional().describe('Report eligible-memory counts without running any LLM/embedding calls'),
    since: z.string().optional().describe('Timestamp cutoff ("YYYY-MM-DD HH:MM:SS" UTC). Re-opens memories already distilled before it — use to start a fresh sweep over a scope already swept once. Omit to only examine never-distilled memories.'),
}, async ({ project, cwd, limit, dry_run, since }) => {
    const r = await distillMemories(db, { project, cwd, limit, dryRun: dry_run, since });
    const remainingNote = r.eligibleRemaining > 0
        ? ` ${r.eligibleRemaining} memories under this scope have not been examined yet — re-invoke to continue (even if this run found 0 clusters).`
        : ' Sweep complete for this scope — nothing left un-examined.';
    const text = r.dryRun
        ? `Dry run: ${r.processed} memor${r.processed === 1 ? 'y' : 'ies'} would be processed under scope '${r.scope}'.${remainingNote}`
        : `Distill complete: ${r.clusters} cluster(s) → ${r.created} consolidated memories (${r.merged} folded in), ${r.rejected} rejected by the coverage gate (sources left intact), ${r.sanitized} tightened, ${r.embedded} embedded. Scope: ${r.scope}, processed ${r.processed}.${remainingNote}`;
    return { content: [{ type: 'text', text }] };
});
// ── nexus_backfill ───────────────────────────────────────────────────
server.tool('nexus_backfill', 'Retroactively extract memories from past sessions that predate the capture hooks. Bounded — processes recent un-analyzed sessions for a project. For a full backfill across all history, use the `nexus backfill` CLI command.', {
    project: z.string().optional().describe('Project slug. Prefer cwd to avoid guessing the slug.'),
    cwd: z.string().optional().describe('Working directory — derives the project slug automatically.'),
    limit: z.coerce.number().optional().describe('Max sessions to process (capped at 30)'),
    dry_run: z.boolean().optional().describe('Report how many sessions would be processed, run nothing'),
}, async ({ project, cwd, limit, dry_run }) => {
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(db, cwd) : undefined);
    const r = await backfillSessions(db, {
        project: effectiveProject,
        limit: Math.min(limit ?? 10, 30),
        dryRun: dry_run,
    });
    const text = r.dryRun
        ? `${r.selected} session(s) would be backfilled.`
        : `Backfill: ${r.processed}/${r.selected} sessions processed — ${r.inserted} memories created, ${r.merged} merged, ${r.skippedNoSignal} had nothing durable.`;
    return { content: [{ type: 'text', text }] };
});
// ── nexus_reindex ───────────────────────────────────────────────────
server.tool('nexus_reindex', 'Force a full re-index of all Claude knowledge files. Call after saving new memory files via the Write tool, or if search results seem stale.', {}, async () => {
    const stats = await runFullIndex(db);
    return {
        content: [{
                type: 'text',
                text: `Re-index complete: ${stats.atomsCreated} created, ${stats.atomsUpdated} updated, ${stats.atomsUnchanged} unchanged, ${stats.linksCreated} links, ${stats.sessionsIndexed} sessions.`,
            }],
    };
});
// ── nexus_crossref ───────────────────────────────────────────────────
server.tool('nexus_crossref', 'Hybrid cross-reference search: merges dense (vector) and sparse (BM25) retrieval via RRF. Annotates each result with its link_type from atom_links when available. Use to discover semantically related atoms you didn\'t know to search for directly.', {
    query: z.string().describe('Search query'),
    project: z.string().optional().describe('Filter by project slug'),
    cwd: z.string().optional().describe('Caller working directory — derives project slug automatically'),
    limit: z.coerce.number().optional().describe('Max results to return (default 10)'),
}, async ({ query, project, cwd, limit }) => {
    const cap = limit ?? 10;
    const knnLimit = cap * 2;
    // Dense KNN over atoms_vec
    const denseResults = [];
    try {
        const vec = await generateEmbedding(query);
        if (vec) {
            const { vecToBlob, normalize } = await import('../core/memories.js');
            const blob = vecToBlob(normalize(vec));
            const knnRows = db.prepare(`SELECT a.id, av.distance FROM atoms_vec av
           JOIN atoms a ON a.rowid = av.rowid
           WHERE av.embedding MATCH ?
           ORDER BY av.distance
           LIMIT ?`).all(blob, knnLimit);
            for (const r of knnRows) {
                const sim = Math.max(0, 1 - (r.distance * r.distance) / 2);
                denseResults.push({ id: r.id, score: sim });
            }
        }
    }
    catch {
        // atoms_vec unavailable — BM25-only fallback
    }
    // BM25
    const bm25Results = [];
    try {
        const allAtoms = db.prepare(`SELECT id, title, body FROM atoms`).all();
        if (allAtoms.length >= 3) {
            const corpus = buildBm25Corpus(allAtoms);
            const raw = corpus.search(query, knnLimit);
            for (const [ref, score] of raw) {
                bm25Results.push({ id: ref, score });
            }
        }
    }
    catch {
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
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(db, cwd) : undefined);
    const parts = ['# Cross-References\n'];
    for (const r of normalized) {
        // Fetch atom details
        let atomRow;
        try {
            atomRow = db.prepare(`SELECT id, title, atom_type, body, project FROM atoms WHERE id = ?`).get(r.id);
        }
        catch {
            continue;
        }
        if (!atomRow)
            continue;
        if (effectiveProject && atomRow.project !== effectiveProject)
            continue;
        // Look up link_type from atom_links
        let linkType = null;
        try {
            const linkRow = db.prepare(`SELECT link_type FROM atom_links WHERE source_id = ? LIMIT 1`).get(r.id);
            linkType = linkRow?.link_type ?? null;
        }
        catch { }
        const badge = linkType ? ` [${linkType}]` : '';
        const snippet = atomRow.body.slice(0, 300).replace(/\n/g, ' ');
        parts.push(`### ${atomRow.title}${badge}\n_${atomRow.atom_type} | score: ${r.score.toFixed(2)}_\n\n${snippet}`);
    }
    if (parts.length === 1) {
        return { content: [{ type: 'text', text: 'No cross-references found.' }] };
    }
    return { content: [{ type: 'text', text: parts.join('\n\n') }] };
});
// ── nexus_promotions ─────────────────────────────────────────────────
server.tool('nexus_promotions', 'List memories flagged as promotion candidates (promotion_target != none, not yet promoted, not rejected, not superseded). Grouped by target type. Read-only — never writes.', {
    project: z.string().optional().describe('Filter by project slug'),
    cwd: z.string().optional().describe('Caller working directory — derives project slug automatically. Use instead of project.'),
    target: z.enum(['adr', 'ddr', 'best_practice', 'recipe', 'note']).optional().describe('Filter by promotion target type'),
}, async ({ project, cwd, target }) => {
    const effectiveProject = project ?? (cwd ? resolveProjectFromCwd(db, cwd) : undefined);
    let sql = `SELECT id, title, body, confidence, source_session_id, promotion_target
               FROM memories
               WHERE promotion_target != 'none'
                 AND promoted_to IS NULL
                 AND review_status != 'rejected'
                 AND superseded_by IS NULL`;
    const params = [];
    if (effectiveProject) {
        sql += ` AND project = ?`;
        params.push(effectiveProject);
    }
    if (target) {
        sql += ` AND promotion_target = ?`;
        params.push(target);
    }
    sql += ` ORDER BY promotion_target, confidence DESC`;
    const rows = db.prepare(sql).all(...params);
    if (rows.length === 0) {
        return { content: [{ type: 'text', text: 'No promotion candidates found.' }] };
    }
    // Group by promotion_target
    const grouped = new Map();
    for (const row of rows) {
        const bucket = grouped.get(row.promotion_target) ?? [];
        bucket.push(row);
        grouped.set(row.promotion_target, bucket);
    }
    const sections = [];
    for (const [tgt, candidates] of grouped) {
        const lines = candidates.map(c => {
            const session = c.source_session_id ? ` session:${c.source_session_id.slice(0, 8)}` : '';
            const conf = (c.confidence * 100).toFixed(0);
            return `- **${c.title}** (${conf}%${session})\n  ${c.body.slice(0, 200).replace(/\n/g, ' ')}\n  _id: ${c.id}_`;
        });
        sections.push(`## ${tgt}\n\n${lines.join('\n')}`);
    }
    return {
        content: [{ type: 'text', text: `# Promotion Candidates (${rows.length} total)\n\n${sections.join('\n\n')}` }],
    };
});
// ── nexus_mark_promoted ──────────────────────────────────────────────
server.tool('nexus_mark_promoted', 'Mark a memory as promoted to an external artifact (ADR, DDR, best-practice doc, etc.). Rewrites the body to a thin pointer (first sentence → artifact_ref) and re-embeds. review_status is never touched.', {
    id: z.string().describe('Memory id to promote'),
    artifact_ref: z.string().describe('Reference to the promoted artifact (e.g. "ADR-013", "ddr-005-promotion-classification.md")'),
}, async ({ id, artifact_ref }) => {
    const memory = getMemory(db, id);
    if (!memory) {
        return { content: [{ type: 'text', text: `Error: memory not found with id ${id}` }] };
    }
    // D-006: rewrite body to thin pointer — first sentence → artifact_ref,
    // appending the ref only if it is not already present.
    const firstSentence = memory.body.split(/(?<=[.!?])\s/)[0].trim();
    const newBody = firstSentence && !firstSentence.includes(artifact_ref)
        ? `${firstSentence} → ${artifact_ref}`
        : firstSentence;
    // Same identifier guarantee as distill's merge/sanitize paths: this rewrites
    // body to a thin pointer, so the full identifier set the original body named
    // must be carried forward explicitly rather than re-derived from the (much
    // shorter) pointer text alone.
    const newIdentifiers = unionIdentifiers(memory.identifiers, extractIdentifiers(newBody));
    db.prepare(`UPDATE memories SET body = ?, promoted_to = ?, identifiers = ?, updated_at = datetime('now') WHERE id = ?`).run(newBody, artifact_ref, JSON.stringify(newIdentifiers), id);
    // D-005: re-embed the rewritten body — best-effort, failure does not fail the tool
    embedMemory(db, id).catch(() => { });
    return {
        content: [{ type: 'text', text: `"${memory.title}" marked promoted → ${artifact_ref}` }],
    };
});
// ── Start server ─────────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    console.error('MCP server error:', err);
    process.exit(1);
});
//# sourceMappingURL=server.js.map