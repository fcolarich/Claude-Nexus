/**
 * Hybrid linking core — BM25 + dense KNN merged via Reciprocal Rank Fusion.
 * Called by the indexer (linkAtom) and reflector (linkMemory) after each embed.
 */
import BM25 from 'wink-bm25-text-search';
import { vecToBlob, normalize } from './memories.js';
const RELATED_LOW = 0.70;
const RELATED_HIGH = 0.86;
const RRF_K = 60;
const TOP_K = 12;
const KNN_LIMIT = 24;
/**
 * Build a wink-bm25 index from a list of atoms/memories.
 * Needs ≥ 3 docs to consolidate successfully.
 */
export function buildBm25Corpus(docs) {
    const index = BM25();
    index.defineConfig({ fldWeights: { text: 1 } });
    // Simple whitespace tokenizer — no external NLP deps required
    index.definePrepTasks([(t) => t.toLowerCase().split(/\W+/).filter(Boolean)]);
    for (const doc of docs) {
        index.addDoc({ text: `${doc.title} ${doc.body}` }, doc.id);
    }
    // wink-bm25 v3 requires at least 3 docs to consolidate
    if (docs.length >= 3) {
        index.consolidate();
    }
    return index;
}
/**
 * Standard RRF rank merge. score += 1/(K + rank) for each list.
 * rank is 1-indexed. Returns top topK items sorted descending by merged score.
 */
export function rrfMerge(bm25Results, denseResults, topK = TOP_K, K = RRF_K) {
    const scores = new Map();
    for (let i = 0; i < bm25Results.length; i++) {
        const { id } = bm25Results[i];
        scores.set(id, (scores.get(id) ?? 0) + 1 / (K + i + 1));
    }
    for (let i = 0; i < denseResults.length; i++) {
        const { id } = denseResults[i];
        scores.set(id, (scores.get(id) ?? 0) + 1 / (K + i + 1));
    }
    return Array.from(scores.entries())
        .map(([id, score]) => ({ id, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}
/**
 * Upsert a bidirectional link between two nodes. Skips self-links.
 * table: 'atom_links' links atoms; 'memory_links' links memories/atoms.
 */
export function upsertLink(db, sourceId, targetId, linkType, confidence, table = 'atom_links') {
    if (sourceId === targetId)
        return;
    const stmt = db.prepare(`INSERT OR IGNORE INTO ${table} (source_id, target_id, link_type, confidence)
     VALUES (?, ?, ?, ?)`);
    stmt.run(sourceId, targetId, linkType, confidence);
    stmt.run(targetId, sourceId, linkType, confidence);
}
/**
 * Hybrid-link a single atom against the corpus.
 * Skips if linked_at > updated_at (already current).
 * Updates atoms.linked_at after processing.
 */
export async function linkAtom(db, atomId, embedFn, corpus) {
    const row = db.prepare(`SELECT id, title, body, linked_at, updated_at FROM atoms WHERE id = ?`).get(atomId);
    if (!row)
        return;
    // Skip guard: already linked after last update
    if (row.linked_at && row.linked_at > row.updated_at)
        return;
    const vec = await embedFn(`${row.title}\n${row.body}`);
    if (!vec)
        return;
    // Dense KNN
    const denseResults = [];
    const denseScores = new Map();
    try {
        const vecTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='atoms_vec'`).get();
        if (vecTable) {
            const blob = vecToBlob(normalize(vec));
            const knnRows = db.prepare(`SELECT a.id, av.distance FROM atoms_vec av
         JOIN atoms a ON a.rowid = av.rowid
         WHERE av.embedding MATCH ?
         AND a.id != ?
         ORDER BY av.distance
         LIMIT ${KNN_LIMIT}`).all(blob, atomId);
            for (const r of knnRows) {
                // L2 distance → cosine similarity: sim = 1 - (d² / 2)
                const sim = Math.max(0, 1 - (r.distance * r.distance) / 2);
                denseScores.set(r.id, sim);
                denseResults.push({ id: r.id, score: sim });
            }
        }
    }
    catch {
        // atoms_vec unavailable — fall back to BM25-only
    }
    // BM25
    const bm25Results = [];
    const effectiveCorpus = corpus ?? buildFallbackAtomCorpus(db);
    if (effectiveCorpus) {
        try {
            const query = `${row.title} ${row.body}`.slice(0, 500);
            const bm25Raw = effectiveCorpus.search(query, KNN_LIMIT);
            for (const [ref, score] of bm25Raw) {
                if (ref !== atomId)
                    bm25Results.push({ id: ref, score });
            }
        }
        catch {
            // BM25 search failed (e.g. corpus too small) — skip
        }
    }
    // RRF merge
    const merged = rrfMerge(bm25Results, denseResults, TOP_K);
    // Apply threshold and upsert links
    for (const result of merged) {
        if (result.id === atomId)
            continue;
        const sim = denseScores.get(result.id);
        let linkType;
        if (sim === undefined) {
            // BM25-only hit — use 'related' at low confidence
            linkType = 'related';
            upsertLink(db, atomId, result.id, linkType, 0.7);
        }
        else if (sim >= RELATED_HIGH) {
            linkType = 'duplicates';
            upsertLink(db, atomId, result.id, linkType, sim);
        }
        else if (sim >= RELATED_LOW) {
            linkType = 'related';
            upsertLink(db, atomId, result.id, linkType, sim);
        }
        // else: below threshold, skip
    }
    db.prepare(`UPDATE atoms SET linked_at = datetime('now') WHERE id = ?`).run(atomId);
}
/**
 * Hybrid-link a single memory against the corpus.
 * Skips if linked_at > updated_at.
 * Updates memories.linked_at after processing.
 */
export async function linkMemory(db, memoryId, embedFn, corpus) {
    const row = db.prepare(`SELECT id, title, body, linked_at, updated_at FROM memories WHERE id = ?`).get(memoryId);
    if (!row)
        return;
    // Skip guard
    if (row.linked_at && row.linked_at > row.updated_at)
        return;
    const vec = await embedFn(`${row.title}\n${row.body}`);
    if (!vec)
        return;
    // Dense KNN over memories_vec
    const denseResults = [];
    const denseScores = new Map();
    try {
        const vecTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memories_vec'`).get();
        if (vecTable) {
            const blob = vecToBlob(normalize(vec));
            const knnRows = db.prepare(`SELECT m.id, mv.distance FROM memories_vec mv
         JOIN memories m ON m.rowid = mv.rowid
         WHERE mv.embedding MATCH ?
         AND m.id != ?
         AND m.superseded_by IS NULL
         ORDER BY mv.distance
         LIMIT ${KNN_LIMIT}`).all(blob, memoryId);
            for (const r of knnRows) {
                const sim = Math.max(0, 1 - (r.distance * r.distance) / 2);
                denseScores.set(r.id, sim);
                denseResults.push({ id: r.id, score: sim });
            }
        }
    }
    catch {
        // memories_vec unavailable
    }
    // BM25 over atom corpus
    const bm25Results = [];
    const effectiveCorpus = corpus ?? buildFallbackAtomCorpus(db);
    if (effectiveCorpus) {
        try {
            const query = `${row.title} ${row.body}`.slice(0, 500);
            const bm25Raw = effectiveCorpus.search(query, KNN_LIMIT);
            for (const [ref, score] of bm25Raw) {
                if (ref !== memoryId)
                    bm25Results.push({ id: ref, score });
            }
        }
        catch {
            // BM25 search failed
        }
    }
    const merged = rrfMerge(bm25Results, denseResults, TOP_K);
    for (const result of merged) {
        if (result.id === memoryId)
            continue;
        const sim = denseScores.get(result.id);
        if (sim === undefined) {
            upsertLink(db, memoryId, result.id, 'related', 0.7, 'memory_links');
        }
        else if (sim >= RELATED_HIGH) {
            upsertLink(db, memoryId, result.id, 'duplicates', sim, 'memory_links');
        }
        else if (sim >= RELATED_LOW) {
            upsertLink(db, memoryId, result.id, 'related', sim, 'memory_links');
        }
    }
    db.prepare(`UPDATE memories SET linked_at = datetime('now') WHERE id = ?`).run(memoryId);
}
/** Build a BM25 corpus over all non-superseded atoms. Used as fallback when no corpus is passed. */
function buildFallbackAtomCorpus(db) {
    try {
        const atoms = db.prepare(`SELECT id, title, body FROM atoms LIMIT 1000`).all();
        if (atoms.length < 3)
            return null;
        return buildBm25Corpus(atoms);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=links.js.map