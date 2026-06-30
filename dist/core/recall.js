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
import { generateEmbedding } from './embeddings.js';
import { normalize } from './memories.js';
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
        // Cap the titles-only overflow — without this every eligible memory (thousands)
        // is dumped at SessionStart, bloating the injection to >100KB. Show the top-N
        // by score (already sorted) and note how many were elided.
        const shown = titleItems.slice(0, cfg.max_title_items);
        const elided = titleItems.length - shown.length;
        parts.push('## More memories (titles only — recall budget reached)');
        parts.push(shown.map(i => titleLine(i.memory)).join('\n'));
        if (elided > 0) {
            parts.push(`_…and ${elided} more lower-ranked memories not shown. Use nexus_search to query them._`);
        }
    }
    const markdown = parts.join('\n\n');
    return { items, markdown, tokenEstimate: estTokens(markdown), total: eligible.length };
}
/**
 * Prompt-driven recall: rank memories by vector cosine similarity to a query,
 * keep only those above a relevance floor, exclude a caller-supplied id set
 * (per-session dedup), and return the top `limit`. Falls back to FTS5 only when
 * no embedding is available or the corpus has no vectors — never bypasses the
 * floor on an embedded corpus.
 */
export async function recallByQuery(db, opts) {
    const empty = { items: [], markdown: '', tokenEstimate: 0, total: 0 };
    const memoriesExist = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memories'`).get();
    if (!memoriesExist)
        return empty;
    const cfg = getNexusConfig().recall;
    const limit = opts.limit ?? 5;
    const minSimilarity = opts.minSimilarity ?? cfg.min_similarity;
    const project = opts.project ?? '';
    const exclude = new Set(opts.excludeIds ?? []);
    const scopeClause = `(m.scope IN ('global','shared') OR (m.scope='project' AND m.project = @project))`;
    const scored = [];
    let vecEligible = 0; // in-scope approved candidates the vector index produced (pre-floor)
    const queryVec = await generateEmbedding(opts.query);
    const vecTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memories_vec'`).get();
    if (queryVec && vecTable) {
        const norm = normalize(queryVec);
        let rows = [];
        try {
            rows = db.prepare(`
        SELECT rowid, distance FROM memories_vec
        WHERE embedding MATCH json(@v)
        ORDER BY distance
        LIMIT @k
      `).all({ v: JSON.stringify(Array.from(norm)), k: Math.max(limit * 6, 30) });
        }
        catch {
            rows = [];
        }
        for (const r of rows) {
            const row = db.prepare(`
        SELECT m.* FROM memories m
        WHERE m.rowid = @rowid
          AND m.review_status = 'approved' AND m.superseded_by IS NULL
          AND ${scopeClause}
      `).get({ rowid: r.rowid, project });
            if (!row)
                continue;
            const m = rowToMemory(row);
            vecEligible++; // corpus is embedded and produced an in-scope candidate
            if (exclude.has(m.id))
                continue;
            // Stored vectors are unit-normalized: cosine similarity = 1 - d^2/2
            const sim = Math.max(0, Math.min(1, 1 - (r.distance * r.distance) / 2));
            if (sim < minSimilarity)
                continue; // relevance floor
            scored.push({ m, score: sim });
        }
    }
    // FTS5 fallback ONLY when the vector path could not run (no embedding / no
    // vectors). If vectors existed but nothing cleared the floor, respect that.
    if (scored.length === 0 && vecEligible === 0) {
        const rows = db.prepare(`
      SELECT m.* FROM memories_fts f
      JOIN memories m ON m.rowid = f.rowid
      WHERE memories_fts MATCH @q
        AND m.review_status = 'approved' AND m.superseded_by IS NULL
        AND ${scopeClause}
      ORDER BY f.rank
      LIMIT @lim
    `).all({ q: sanitizeFts5Query(opts.query), project, lim: limit * 3 });
        for (const row of rows) {
            const m = rowToMemory(row);
            if (exclude.has(m.id))
                continue;
            scored.push({ m, score: 0 });
        }
    }
    if (scored.length === 0)
        return empty;
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);
    const items = top.map(({ m, score }) => ({ memory: m, score, mode: 'full' }));
    const HEADER = '# Recalled Memory\n';
    const parts = [HEADER.trim()];
    for (const i of items)
        parts.push(renderFull(i.memory).trim());
    const markdown = parts.join('\n\n');
    return { items, markdown, tokenEstimate: estTokens(markdown), total: scored.length };
}
//# sourceMappingURL=recall.js.map