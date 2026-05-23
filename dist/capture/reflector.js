/**
 * The Reflector — core of the capture pipeline.
 *
 * Reads a session transcript from its reflection cursor, condenses it, extracts
 * typed memory candidates, dedup/merges them against existing memories, writes
 * the survivors, and advances the cursor. Idempotent: re-running only processes
 * transcript lines added since the last run.
 *
 * Markdown export is the caller's responsibility (runner / API) so reflect()
 * stays filesystem-free and unit-testable.
 */
import { getNexusConfig } from '../core/config.js';
import { generateEmbedding } from '../core/embeddings.js';
import { insertMemory, touchMemory, embedMemory, findSimilarMemory, normalize, } from '../core/memories.js';
import { readTranscriptWindow } from './transcript.js';
import { extractMemories } from './extract.js';
/**
 * Reflect over a session transcript and write any new memories.
 * `deps` lets tests inject a fake extractor / embedder.
 */
export async function reflect(db, opts, deps = {}) {
    const extract = deps.extract ?? extractMemories;
    const embed = deps.embed ?? generateEmbedding;
    const cfg = getNexusConfig().capture;
    // Ensure a session row exists to hold the reflection cursor. The indexer
    // enriches the other columns later (ON CONFLICT preserves last_reflected_index).
    db.prepare(`INSERT OR IGNORE INTO sessions (session_id, project, jsonl_path, status) VALUES (?, ?, ?, 'dead')`).run(opts.session_id, opts.project ?? 'unknown', opts.transcript_path);
    const sessRow = db.prepare(`SELECT last_reflected_index FROM sessions WHERE session_id = ?`).get(opts.session_id);
    const fromIndex = sessRow?.last_reflected_index ?? 0;
    const window = readTranscriptWindow(opts.transcript_path, fromIndex);
    const advanceCursor = (to) => db.prepare(`UPDATE sessions SET last_reflected_index = ? WHERE session_id = ?`).run(to, opts.session_id);
    // Observer gate — nothing worth an LLM call. Advance past these lines anyway.
    if (window.newLines === 0 || !window.hasSignal) {
        advanceCursor(window.totalLines);
        return { session_id: opts.session_id, project: opts.project, newLines: window.newLines, extracted: 0, inserted: 0, merged: 0, skipped: true };
    }
    const candidates = await extract(window.text, { project: opts.project });
    let inserted = 0;
    let merged = 0;
    for (const c of candidates) {
        const memProject = c.scope === 'project' ? opts.project : null;
        // Semantic dedup — a near-identical memory already exists -> reconfirm it.
        const vec = await embed(c.body);
        if (vec) {
            const sim = findSimilarMemory(db, normalize(vec), { scope: c.scope, project: memProject, excludeSuperseded: true });
            if (sim && sim.similarity >= cfg.dedup_cosine_threshold) {
                touchMemory(db, sim.memory.id);
                merged++;
                continue;
            }
        }
        const review_status = c.confidence >= cfg.auto_approve_confidence ? 'approved' : 'pending';
        const res = insertMemory(db, {
            title: c.title,
            body: c.body,
            memory_type: c.memory_type,
            scope: c.scope,
            project: memProject,
            confidence: c.confidence,
            decay_class: c.decay_class,
            review_status,
            source_session_id: opts.session_id,
            discovered_from: null,
            tags: c.tags,
        });
        if (res.inserted) {
            inserted++;
            await embedMemory(db, res.id, embed);
        }
        else {
            // Exact content-id collision — same memory text already stored. Reconfirm.
            touchMemory(db, res.id);
            merged++;
        }
    }
    advanceCursor(window.totalLines);
    return {
        session_id: opts.session_id,
        project: opts.project,
        newLines: window.newLines,
        extracted: candidates.length,
        inserted,
        merged,
        skipped: false,
    };
}
//# sourceMappingURL=reflector.js.map