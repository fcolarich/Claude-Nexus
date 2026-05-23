/**
 * Recall — budgeted retrieval of memories for injection into a session.
 *
 * Ranks approved memories by effective-confidence x help-rate, pins
 * load_at_init memories, then walks a token budget: full bodies until the
 * budget is reached, titles-only thereafter. Pure read — no mutation, no
 * network — so it is cheap enough for the SessionStart hot path.
 */
import { getNexusConfig } from './config.js';
import { sanitizeFts5Query } from './search.js';
import { effectiveConfidence } from './decay.js';
const estTokens = (s) => Math.ceil(s.length / 4);
function rowToMemory(r) {
    return { ...r, tags: JSON.parse(r.tags || '[]') };
}
function scoreMemory(m) {
    const helpRate = m.use_count > 0
        ? Math.max(0.5, Math.min(1.5, 0.5 + m.help_count / m.use_count))
        : 1.0;
    return effectiveConfidence(m) * helpRate;
}
function renderFull(m) {
    const badge = m.scope === 'global' ? ' [GLOBAL]' : m.scope === 'shared' ? ' [SHARED]' : '';
    return `## [${m.memory_type}] ${m.title}${badge}\n${m.body}\n`;
}
function titleLine(m) {
    return `- [${m.memory_type}] ${m.title}`;
}
/**
 * Recall memories for a project. With no query, returns the project's most
 * relevant memories for session-start injection. With a query, restricts to
 * FTS matches first, then ranks.
 */
export function recallMemories(db, opts) {
    const empty = { items: [], markdown: '', tokenEstimate: 0, total: 0 };
    // memories table is absent on a pre-v2 database
    const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memories'`).get();
    if (!exists)
        return empty;
    const cfg = getNexusConfig().recall;
    const maxTokens = opts.maxTokens ?? cfg.max_tokens;
    const project = opts.project ?? '';
    // Dual-bank: project-scoped memories + global/shared memories.
    const scopeClause = `(m.scope IN ('global','shared') OR (m.scope='project' AND m.project = @project))`;
    let rows;
    if (opts.query && opts.query.trim()) {
        rows = db.prepare(`
      SELECT m.* FROM memories_fts f
      JOIN memories m ON m.rowid = f.rowid
      WHERE memories_fts MATCH @q
        AND m.review_status = 'approved' AND m.superseded_by IS NULL
        AND ${scopeClause}
    `).all({ q: sanitizeFts5Query(opts.query), project });
    }
    else {
        rows = db.prepare(`
      SELECT m.* FROM memories m
      WHERE m.review_status = 'approved' AND m.superseded_by IS NULL
        AND ${scopeClause}
    `).all({ project });
    }
    // Eligibility: effective (decayed) confidence must clear the threshold,
    // unless the memory is explicitly pinned for session-init loading.
    const eligible = rows
        .map(rowToMemory)
        .filter(m => m.load_at_init === 1 || effectiveConfidence(m) >= cfg.min_confidence);
    if (eligible.length === 0)
        return empty;
    // Rank: load_at_init pinned first, then by score.
    const scored = eligible.map(m => ({ m, score: scoreMemory(m) }));
    scored.sort((a, b) => {
        if (a.m.load_at_init !== b.m.load_at_init)
            return b.m.load_at_init - a.m.load_at_init;
        return b.score - a.score;
    });
    // Budget walk: full bodies until the budget is hit, titles-only after.
    const HEADER = '# Recalled Memory\n';
    let used = estTokens(HEADER);
    let overflowed = false;
    const items = [];
    for (const { m, score } of scored) {
        if (!overflowed) {
            const cost = estTokens(renderFull(m));
            if (m.load_at_init || used + cost <= maxTokens) {
                items.push({ memory: m, score, mode: 'full' });
                used += cost;
                continue;
            }
            overflowed = true;
        }
        items.push({ memory: m, score, mode: 'title' });
        used += estTokens(titleLine(m) + '\n');
    }
    // Render
    const fullItems = items.filter(i => i.mode === 'full');
    const titleItems = items.filter(i => i.mode === 'title');
    const parts = [HEADER.trim()];
    for (const i of fullItems)
        parts.push(renderFull(i.memory).trim());
    if (titleItems.length > 0) {
        parts.push('## More memories (titles only — recall budget reached)');
        parts.push(titleItems.map(i => titleLine(i.memory)).join('\n'));
    }
    const markdown = parts.join('\n\n');
    return { items, markdown, tokenEstimate: estTokens(markdown), total: eligible.length };
}
//# sourceMappingURL=recall.js.map