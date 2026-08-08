/**
 * Memory data layer — CRUD, embedding, and similarity for the `memories` table.
 * The autonomous memory engine's store. Used by the Reflector (capture) and,
 * later, by recall.
 */
import { createHash } from 'crypto';
import { generateEmbedding, ensureEmbeddingModelReady } from './embeddings.js';
import { extractIdentifiers } from './identifiers.js';
/** Content-addressed id — identical (type, body) collapses to one row. */
export function computeMemoryId(memory_type, body) {
    return createHash('sha256').update(`${memory_type}\n${body.trim()}`).digest('hex').slice(0, 16);
}
function contentHash(body) {
    return createHash('sha256').update(body.trim()).digest('hex');
}
/**
 * Serialize a vector for a sqlite-vec BLOB column. better-sqlite3 will not bind
 * a Float32Array directly — it must be handed the raw bytes as a Buffer.
 */
export function vecToBlob(v) {
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}
/** Unit-normalize a vector so L2 distance maps cleanly to cosine similarity. */
export function normalize(v) {
    let sum = 0;
    for (let i = 0; i < v.length; i++)
        sum += v[i] * v[i];
    const mag = Math.sqrt(sum);
    if (mag === 0)
        return v;
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++)
        out[i] = v[i] / mag;
    return out;
}
function rowToMemory(row) {
    return {
        ...row,
        tags: JSON.parse(row.tags || '[]'),
        identifiers: JSON.parse(row.identifiers || '[]'),
    };
}
/** Insert a memory. Returns inserted=false if the content-addressed id already exists. */
export function insertMemory(db, input) {
    const id = computeMemoryId(input.memory_type, input.body);
    // Deterministic, code-only extraction — never a model. Callers that already
    // computed a set-union (distill.ts, on merge) pass identifiers explicitly so
    // that union is preserved rather than overwritten by a fresh extraction that
    // only sees the merged body's own text.
    const identifiers = input.identifiers ?? extractIdentifiers(`${input.title}\n${input.body}`);
    const res = db.prepare(`
    INSERT OR IGNORE INTO memories
      (id, title, body, memory_type, scope, project, confidence, decay_class,
       review_status, promotion_target, source_session_id, discovered_from, tags, content_hash, load_at_init, identifiers)
    VALUES
      (@id, @title, @body, @memory_type, @scope, @project, @confidence, @decay_class,
       @review_status, @promotion_target, @source_session_id, @discovered_from, @tags, @content_hash, @load_at_init, @identifiers)
  `).run({
        id,
        title: input.title,
        body: input.body,
        memory_type: input.memory_type,
        scope: input.scope,
        project: input.project,
        confidence: input.confidence,
        decay_class: input.decay_class,
        review_status: input.review_status,
        promotion_target: input.promotion_target,
        source_session_id: input.source_session_id,
        discovered_from: input.discovered_from,
        tags: JSON.stringify(input.tags),
        content_hash: contentHash(input.body),
        load_at_init: input.load_at_init ? 1 : 0,
        identifiers: JSON.stringify(identifiers),
    });
    return { id, inserted: res.changes > 0 };
}
/**
 * Batch-insert memories in ONE transaction (single fsync) with per-item
 * try/catch — a throwing item is recorded as status:'error' and does NOT abort
 * the rest. Embedding runs best-effort AFTER commit (outside the transaction).
 * `embed` is injectable for tests; defaults to embedMemory against this db.
 */
export async function rememberBatch(db, items, embed = (id) => embedMemory(db, id)) {
    const results = new Array(items.length);
    db.transaction(() => {
        items.forEach((input, index) => {
            try {
                const { id, inserted } = insertMemory(db, input);
                results[index] = { index, id, status: inserted ? 'written' : 'duplicate' };
            }
            catch (err) {
                results[index] = { index, status: 'error', reason: err instanceof Error ? err.message : String(err) };
            }
        });
    })();
    // Best-effort embed for every newly-written id, after the txn commits.
    await Promise.all(results
        .filter((r) => r.status === 'written' && r.id)
        .map((r) => embed(r.id).catch(() => false)));
    return { results };
}
export function getMemory(db, id) {
    const row = db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id);
    return row ? rowToMemory(row) : undefined;
}
export function listMemories(db, opts) {
    let sql = `SELECT * FROM memories WHERE 1=1`;
    const params = [];
    if (opts?.review_status) {
        sql += ` AND review_status = ?`;
        params.push(opts.review_status);
    }
    if (opts?.project) {
        sql += ` AND project = ?`;
        params.push(opts.project);
    }
    if (opts?.memory_type) {
        sql += ` AND memory_type = ?`;
        params.push(opts.memory_type);
    }
    if (opts?.scope) {
        sql += ` AND scope = ?`;
        params.push(opts.scope);
    }
    if (!opts?.includeSuperseded)
        sql += ` AND superseded_by IS NULL`;
    sql += ` ORDER BY confidence DESC, updated_at DESC`;
    if (opts?.limit) {
        sql += ` LIMIT ?`;
        params.push(opts.limit);
    }
    return db.prepare(sql).all(...params).map(rowToMemory);
}
/**
 * Reconfirm an existing memory — the Reflector saw it again this session.
 * Nudges confidence up and resets the decay clock.
 */
export function touchMemory(db, id) {
    db.prepare(`
    UPDATE memories
    SET confidence = MIN(1.0, confidence + 0.05),
        last_verified_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
}
/** Hard-delete a memory and its vector row. Returns false if the id was absent. */
export function deleteMemory(db, id) {
    const row = db.prepare(`SELECT rowid FROM memories WHERE id = ?`).get(id);
    if (!row)
        return false;
    try {
        db.prepare(`DELETE FROM memories_vec WHERE rowid = ?`).run(row.rowid);
    }
    catch { /* vec table absent */ }
    db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    return true;
}
/** Generate + store a normalized embedding for one memory. Returns false if embedding unavailable. */
export async function embedMemory(db, id, embedFn = generateEmbedding) {
    const row = db.prepare(`SELECT rowid, title, body FROM memories WHERE id = ?`).get(id);
    if (!row)
        return false;
    const vec = await embedFn(`${row.title}\n${row.body}`);
    if (!vec)
        return false;
    try {
        // sqlite-vec rejects a bound parameter for the rowid primary key — it must
        // be a SQL literal. row.rowid is a SQLite integer, so interpolation is safe.
        db.prepare(`DELETE FROM memories_vec WHERE rowid = ?`).run(row.rowid);
        db.prepare(`INSERT INTO memories_vec(rowid, embedding) VALUES (${row.rowid}, ?)`).run(vecToBlob(normalize(vec)));
        return true;
    }
    catch {
        return false; // memories_vec absent (sqlite-vec not loaded)
    }
}
/** Embed every memory lacking a vector. Mirrors the atoms embedding pass. */
export async function embedUnindexedMemories(db, embedFn = generateEmbedding) {
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memories_vec'`).get();
    if (!tableExists)
        return { embedded: 0, skipped: 0 };
    const rows = db.prepare(`
    SELECT id FROM memories WHERE rowid NOT IN (SELECT rowid FROM memories_vec)
  `).all();
    if (rows.length === 0)
        return { embedded: 0, skipped: 0 };
    // Warm up the model once before the bulk pass — waits for cold load rather
    // than flooding the loop with 500s while Ollama loads the model.
    const ready = await ensureEmbeddingModelReady();
    if (!ready) {
        console.warn('[embedUnindexedMemories] embedding model unavailable, skipping');
        return { embedded: 0, skipped: rows.length };
    }
    let embedded = 0;
    let skipped = 0;
    for (const { id } of rows) {
        if (await embedMemory(db, id, embedFn))
            embedded++;
        else
            skipped++;
    }
    return { embedded, skipped };
}
/** Reconfirm a memory — resets the decay clock and nudges confidence up. */
export function verifyMemory(db, id) {
    const res = db.prepare(`
    UPDATE memories
    SET last_verified_at = datetime('now'),
        confidence = MIN(1.0, confidence + 0.1),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
    return res.changes > 0;
}
/** Record whether a recalled memory helped — feeds the help-rate ranking term. */
export function recordFeedback(db, id, helped) {
    const res = db.prepare(`
    UPDATE memories
    SET use_count = use_count + 1,
        help_count = help_count + ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(helped ? 1 : 0, id);
    return res.changes > 0;
}
/**
 * Find the most similar existing memory to a query vector (for dedup).
 * Expects a unit-normalized query vector; returns cosine similarity in [0,1].
 */
export function findSimilarMemory(db, queryVec, opts) {
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memories_vec'`).get();
    if (!tableExists)
        return null;
    let rows;
    try {
        rows = db.prepare(`
      SELECT rowid, distance FROM memories_vec
      WHERE embedding MATCH json(?)
      ORDER BY distance
      LIMIT ?
    `).all(JSON.stringify(Array.from(queryVec)), opts?.k ?? 10);
    }
    catch {
        return null;
    }
    for (const r of rows) {
        const row = db.prepare(`SELECT * FROM memories WHERE rowid = ?`).get(r.rowid);
        if (!row)
            continue;
        const mem = rowToMemory(row);
        if (opts?.excludeId && mem.id === opts.excludeId)
            continue;
        if (opts?.excludeSuperseded && mem.superseded_by)
            continue;
        if (opts?.scope && mem.scope !== opts.scope)
            continue;
        if (opts?.project !== undefined && mem.project !== opts.project)
            continue;
        // Unit vectors: L2 distance d -> cosine similarity = 1 - d^2/2
        const similarity = Math.max(0, Math.min(1, 1 - (r.distance * r.distance) / 2));
        return { memory: mem, similarity };
    }
    return null;
}
//# sourceMappingURL=memories.js.map