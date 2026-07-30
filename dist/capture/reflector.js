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
import { linkMemory } from '../core/links.js';
import { readTranscriptWindow } from './transcript.js';
import { extractMemories } from './extract.js';
import { readDecisionIndex } from './docspine.js';
import { compactWindowLines, compactFileInPlace } from './vcc-bridge.js';
/**
 * Reflect over a session transcript and write any new memories.
 * `deps` lets tests inject a fake extractor / embedder.
 */
export async function reflect(db, opts, deps = {}) {
    const extract = deps.extract ?? extractMemories;
    const embed = deps.embed ?? generateEmbedding;
    const vcc = deps.vcc ?? { compactWindowLines, compactFileInPlace };
    const cfg = getNexusConfig().capture;
    // Ensure a session row exists to hold the reflection cursor. The indexer
    // enriches the other columns later (ON CONFLICT preserves last_reflected_index).
    db.prepare(`INSERT OR IGNORE INTO sessions (session_id, project, jsonl_path, status) VALUES (?, ?, ?, 'dead')`).run(opts.session_id, opts.project ?? 'unknown', opts.transcript_path);
    // Persist cwd only if not already set (reflector owns cwd, indexer does not overwrite)
    if (opts.cwd) {
        db.prepare(`UPDATE sessions SET cwd = ? WHERE session_id = ? AND cwd IS NULL`).run(opts.cwd, opts.session_id);
    }
    const sessRow = db.prepare(`SELECT last_reflected_index FROM sessions WHERE session_id = ?`).get(opts.session_id);
    const fromIndex = sessRow?.last_reflected_index ?? 0;
    const window = readTranscriptWindow(opts.transcript_path, fromIndex);
    const advanceCursor = (to) => db.prepare(`UPDATE sessions SET last_reflected_index = ? WHERE session_id = ?`).run(to, opts.session_id);
    // Observer gate — nothing worth an LLM call. Advance past these lines anyway.
    if (window.newLines === 0 || !window.hasSignal) {
        advanceCursor(window.totalLines);
        return { session_id: opts.session_id, project: opts.project, newLines: window.newLines, extracted: 0, inserted: 0, merged: 0, skipped: true };
    }
    // Pre-extraction compaction — feed the Haiku extractor compacted text when
    // available; fail-open to the raw condensed window text on any error.
    let extractionText = window.text;
    const compacted = vcc.compactWindowLines(window.rawLines, { timeoutMs: 10_000 });
    if (compacted.ok && compacted.text) {
        extractionText = compacted.text;
    }
    else if (!compacted.ok) {
        console.error('[claude-nexus] vcc pre-extraction compaction failed, using raw window text:', compacted.error);
    }
    const decisions = readDecisionIndex(opts.cwd);
    const candidates = await extract(extractionText, { project: opts.project, decisions });
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
            promotion_target: c.promotion_target,
        });
        if (res.inserted) {
            inserted++;
            const embedded = await embedMemory(db, res.id, embed);
            if (embedded) {
                await linkMemory(db, res.id, embed);
            }
        }
        else {
            // Exact content-id collision — same memory text already stored. Reconfirm.
            touchMemory(db, res.id);
            merged++;
        }
    }
    advanceCursor(window.totalLines);
    // Post-extraction inline shrink — DISABLED 2026-07-24. compactFileInPlace()
    // was overwriting live raw JSONL transcripts in place with vcc_compact's
    // rendered summary, and a review found real information loss in that
    // rendering (opaque Bash/PowerShell citations, small-but-critical tool
    // results dropped when not restated in prose). Destroying the only copy of
    // a raw transcript with a known-lossy, irreversible in-place rewrite is not
    // acceptable until vcc_compact's rendering quality is fixed. Do not
    // re-enable by just uncommenting — re-verify the fix first.
    // const shrink = vcc.compactFileInPlace(opts.transcript_path, { timeoutMs: 15_000 });
    // if (shrink.ok) {
    //   db.prepare(`UPDATE sessions SET vcc_shrunk_at = ? WHERE session_id = ?`)
    //     .run(new Date().toISOString(), opts.session_id);
    // } else {
    //   console.error('[claude-nexus] vcc post-extraction shrink failed, vcc_shrunk_at left unset:', shrink.error);
    // }
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