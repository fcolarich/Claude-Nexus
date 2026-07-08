/**
 * Distill — LLM-driven cleanup of EXISTING memories.
 *
 * Where consolidation merges near-identical duplicates structurally, distill
 * goes further: it clusters *related* memories (medium similarity) and rewrites
 * each cluster into one tighter, non-redundant memory, then sanitizes verbose
 * singletons. Use it to clean up legacy / hand-written memories.
 *
 * The rewrite is mechanical (compress these given texts) rather than judgment —
 * a local model is a reasonable choice here. Uses the configured extraction
 * model via callModel().
 */
import { getNexusConfig } from './config.js';
import { generateEmbedding } from './embeddings.js';
import { callModel } from './llm.js';
import { embedUnindexedMemories, insertMemory, embedMemory, normalize } from './memories.js';
const BAND_LOW = 0.70; // below: unrelated. at/above dedup threshold: consolidate's job.
const MAX_CLUSTER = 8;
const SANITIZE_OVER_CHARS = 800;
const MEMORY_TYPES = new Set(['preference', 'convention', 'failure', 'correction', 'decision', 'insight', 'tool_quirk', 'reference', 'handoff']);
const DECAY_CLASSES = new Set(['stable', 'architecture', 'api_contract', 'implementation']);
const SCOPES = new Set(['global', 'shared', 'project']);
const MERGE_PROMPT = `You consolidate related memories into one.

Given several memories about overlapping topics, write a SINGLE memory that captures every distinct fact and rationale from all of them — tighter, clearer, no redundancy. Keep the most specific information; drop nothing that matters.

Output STRICT JSON ONLY, one object:
{"title": "...", "body": "...", "memory_type": "...", "scope": "...", "decay_class": "...", "tags": ["..."]}

memory_type: preference|convention|failure|correction|decision|insight|tool_quirk|reference|handoff
scope: project|global|shared
decay_class: stable|architecture|api_contract|implementation
body: 1-4 self-contained sentences. No prose or fences outside the JSON.`;
const SANITIZE_PROMPT = `Tighten this memory. Remove redundancy and filler; keep every distinct fact and the reasoning. Do not add anything.

Output STRICT JSON ONLY: {"title": "...", "body": "..."}  No prose or fences.`;
function rowToMemory(r) {
    return { ...r, tags: JSON.parse(r.tags || '[]') };
}
function firstJsonObject(raw) {
    if (!raw?.trim())
        return null;
    let parsed;
    try {
        parsed = JSON.parse(raw.trim());
    }
    catch {
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m)
            return null;
        try {
            parsed = JSON.parse(m[0]);
        }
        catch {
            return null;
        }
    }
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}
/** KNN over memories_vec, returning memories whose similarity falls in the related band. */
function relatedMemories(db, queryVec, self, highExclusive) {
    let rows;
    try {
        rows = db.prepare(`
      SELECT rowid, distance FROM memories_vec
      WHERE embedding MATCH json(?) ORDER BY distance LIMIT ?
    `).all(JSON.stringify(Array.from(queryVec)), 12);
    }
    catch {
        return [];
    }
    const out = [];
    for (const r of rows) {
        const row = db.prepare(`SELECT * FROM memories WHERE rowid = ?`).get(r.rowid);
        if (!row)
            continue;
        const mem = rowToMemory(row);
        if (mem.id === self.id || mem.superseded_by)
            continue;
        if (mem.scope !== self.scope || mem.project !== self.project)
            continue;
        const similarity = Math.max(0, Math.min(1, 1 - (r.distance * r.distance) / 2));
        if (similarity >= BAND_LOW && similarity < highExclusive)
            out.push({ memory: mem, similarity });
    }
    return out;
}
export async function distillMemories(db, embedFn = generateEmbedding, callFn = callModel) {
    const dedupThreshold = getNexusConfig().capture.dedup_cosine_threshold;
    const { embedded } = await embedUnindexedMemories(db, embedFn);
    const all = db.prepare(`
    SELECT * FROM memories WHERE superseded_by IS NULL AND review_status != 'rejected'
    ORDER BY confidence DESC, created_at ASC
  `).all().map(rowToMemory);
    const assigned = new Set();
    const result = { embedded, clusters: 0, merged: 0, created: 0, sanitized: 0 };
    const supersede = db.prepare(`UPDATE memories SET superseded_by = ?, updated_at = datetime('now') WHERE id = ?`);
    const link = db.prepare(`INSERT OR IGNORE INTO memory_links (source_id, target_id, link_type, confidence) VALUES (?, ?, 'refines', 1.0)`);
    // ── Cluster + merge ────────────────────────────────────────────────
    for (const m of all) {
        if (assigned.has(m.id))
            continue;
        const vec = await embedFn(m.body);
        if (!vec) {
            assigned.add(m.id);
            continue;
        }
        const related = relatedMemories(db, normalize(vec), m, dedupThreshold)
            .filter(r => !assigned.has(r.memory.id));
        if (related.length === 0) {
            assigned.add(m.id);
            continue;
        }
        const cluster = [m, ...related.map(r => r.memory)].slice(0, MAX_CLUSTER);
        for (const c of cluster)
            assigned.add(c.id);
        result.clusters++;
        const listing = cluster
            .map((c, i) => `[${i + 1}] (${c.memory_type}) ${c.title}\n${c.body}`)
            .join('\n\n');
        const obj = firstJsonObject(await callFn(MERGE_PROMPT, listing));
        if (!obj || typeof obj.title !== 'string' || typeof obj.body !== 'string')
            continue;
        const memory_type = MEMORY_TYPES.has(obj.memory_type) ? obj.memory_type : m.memory_type;
        const scope = SCOPES.has(obj.scope) ? obj.scope : m.scope;
        const decay_class = DECAY_CLASSES.has(obj.decay_class) ? obj.decay_class : m.decay_class;
        const tags = Array.isArray(obj.tags)
            ? obj.tags.filter(t => typeof t === 'string').map(t => t.toLowerCase()).slice(0, 5)
            : [];
        const ins = insertMemory(db, {
            title: obj.title.slice(0, 120),
            body: obj.body,
            memory_type,
            scope,
            project: m.project,
            confidence: Math.max(...cluster.map(c => c.confidence)),
            decay_class,
            review_status: 'approved',
            source_session_id: null,
            discovered_from: null,
            tags,
            load_at_init: cluster.some(c => c.load_at_init === 1),
            promotion_target: 'none',
        });
        if (!ins.inserted)
            continue;
        result.created++;
        await embedMemory(db, ins.id, embedFn);
        for (const c of cluster) {
            supersede.run(ins.id, c.id);
            link.run(ins.id, c.id);
            result.merged++;
        }
    }
    // ── Sanitize verbose singletons ────────────────────────────────────
    // Re-read each memory's current state: skip any the merge step superseded.
    for (const m of all) {
        const fresh = db.prepare(`SELECT superseded_by, body FROM memories WHERE id = ?`)
            .get(m.id);
        if (!fresh || fresh.superseded_by)
            continue;
        if (fresh.body.length <= SANITIZE_OVER_CHARS)
            continue;
        const obj = firstJsonObject(await callFn(SANITIZE_PROMPT, `(${m.memory_type}) ${m.title}\n${fresh.body}`));
        if (!obj || typeof obj.body !== 'string' || obj.body.length >= fresh.body.length)
            continue;
        db.prepare(`UPDATE memories SET title = ?, body = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(typeof obj.title === 'string' ? obj.title.slice(0, 120) : m.title, obj.body, m.id);
        await embedMemory(db, m.id, embedFn);
        result.sanitized++;
    }
    return result;
}
//# sourceMappingURL=distill.js.map