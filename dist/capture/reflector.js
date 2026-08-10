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
import { classifyOrigin } from './origin.js';
import { extractMemories, ADR_REF_RE } from './extract.js';
import { readDecisionIndex } from './docspine.js';
import { compactWindowLines, compactFileInPlace, compactToParallelFile } from './vcc-bridge.js';
import { redactSecrets, redactCandidate } from './secrets.js';
/** Threshold (bytes) above which reflect() triggers an end-of-run parallel-file
 * compaction of the whole transcript, independent of the pre-extraction window
 * compaction above. */
export const VCC_PARALLEL_COMPACT_BYTES = 200_000;
const VCC_PARALLEL_COMPACT_TIMEOUT_MS = 15_000;
/**
 * Fail-open wrapper around an injected `redactSecrets`-shaped function
 * (D-009). Never throws — on catch, returns the input text unmodified and
 * logs only the error, never the text or any matched span.
 */
function safeRedact(fn, text, mode) {
    try {
        return fn(text, mode);
    }
    catch (err) {
        console.error('[claude-nexus] secret redaction failed, text passed through unmodified:', err);
        return { text, redactions: [] };
    }
}
/**
 * Fix 1 — ADR-reference demotion. A `reference` candidate carrying a real
 * ADR/DDR id supersedes an earlier `decision` row it duplicates, regardless of
 * that row's `promotion_target` (broadened per design Decision 2). Everything
 * else falls through to the ordinary touch-and-continue dedup path.
 */
function isReferenceUpgrade(candidate, matched, validIds) {
    if (candidate.memory_type !== 'reference'
        || !ADR_REF_RE.test(candidate.body)
        || matched.memory_type !== 'decision'
        || matched.superseded_by != null) {
        return false;
    }
    const id = (candidate.body.match(ADR_REF_RE) ?? [])[0]?.toUpperCase();
    return !!id && validIds.has(id);
}
/**
 * Reflect over a session transcript and write any new memories.
 * `deps` lets tests inject a fake extractor / embedder.
 */
export async function reflect(db, opts, deps = {}) {
    const extract = deps.extract ?? extractMemories;
    const embed = deps.embed ?? generateEmbedding;
    const vcc = deps.vcc ?? { compactWindowLines, compactFileInPlace, compactToParallelFile };
    const cfg = getNexusConfig().capture;
    const allRedactions = [];
    // Origin gate. Runs before the session row is created and before the
    // transcript is read, so an excluded session costs nothing. Deliberately does
    // NOT advance a cursor: if the denylist later changes, the session becomes
    // eligible again from the top.
    // classifyOrigin's cwd param is a required string; opts.cwd is optional (the
    // indexer may not always supply it). Fall back to a placeholder that cannot
    // equal a real homedir or filesystem root, so isNonProjectCwd's comparison
    // fails open (no false exclusion) rather than throwing on undefined.
    const origin = classifyOrigin(opts.transcript_path, opts.cwd ?? 'unknown-cwd', getNexusConfig().exclude);
    if (origin.excluded) {
        return {
            session_id: opts.session_id, project: opts.project, newLines: 0,
            extracted: 0, inserted: 0, merged: 0, upgraded: 0, skipped: true,
            excluded_reason: origin.reason,
        };
    }
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
        return { session_id: opts.session_id, project: opts.project, newLines: window.newLines, extracted: 0, inserted: 0, merged: 0, upgraded: 0, skipped: true };
    }
    // Pre-extraction compaction — feed the Haiku extractor compacted text when
    // available; fail-open to the raw condensed window text on any error.
    let extractionText = window.text;
    const compacted = vcc.compactWindowLines(window.rawLines, { timeoutMs: 10_000 });
    const source = compacted.ok && !!compacted.text ? 'vcc' : 'generic';
    if (compacted.ok && compacted.text) {
        extractionText = compacted.text;
    }
    else if (!compacted.ok) {
        console.error('[claude-nexus] vcc pre-extraction compaction failed, using raw window text:', compacted.error);
    }
    const gate1 = safeRedact(deps.redact ?? redactSecrets, extractionText, 'strict');
    extractionText = gate1.text;
    allRedactions.push(...gate1.redactions);
    const decisions = readDecisionIndex(opts.cwd);
    const validIds = new Set(decisions.map((d) => d.split(':')[0].trim().toUpperCase()));
    const rawCandidates = await extract(extractionText, { project: opts.project, decisions, source });
    // Gate 2 (D-012): rewrite the candidate array before embed()/findSimilarMemory()/
    // insertMemory() consume it, so hashing, embedding, dedup and insert all see
    // redacted text. Per-candidate try/catch (D-009) — one pathological candidate
    // does not disable redaction for its siblings.
    const candidates = rawCandidates.map((c) => {
        try {
            const { candidate, redactions } = redactCandidate(c, deps.redact ?? redactSecrets);
            allRedactions.push(...redactions);
            return candidate;
        }
        catch (err) {
            console.error('[claude-nexus] secret redaction failed, candidate passed through unmodified:', err);
            return c;
        }
    });
    let inserted = 0;
    let merged = 0;
    let upgraded = 0;
    for (const c of candidates) {
        const memProject = c.scope === 'project' ? opts.project : null;
        // Semantic dedup — a near-identical memory already exists -> reconfirm it.
        const vec = await embed(c.body);
        if (vec) {
            const sim = findSimilarMemory(db, normalize(vec), { scope: c.scope, project: memProject, excludeSuperseded: true });
            if (sim && sim.similarity >= cfg.dedup_cosine_threshold) {
                if (isReferenceUpgrade(c, sim.memory, validIds)) {
                    // Fix 1 — supersede-insert. The matched decision row is content-drifted:
                    // insert the reference pointer as its own content-addressed row, then
                    // mark the old decision row superseded. Both writes share one txn so a
                    // throw leaves the pre-existing touch-only state, never a half-state.
                    const review_status = c.confidence >= cfg.auto_approve_confidence ? 'approved' : 'pending';
                    let res;
                    db.transaction(() => {
                        res = insertMemory(db, {
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
                        db.prepare(`UPDATE memories SET superseded_by = ?, updated_at = datetime('now') WHERE id = ?`)
                            .run(res.id, sim.memory.id);
                    })();
                    if (res.inserted) {
                        const embedded = await embedMemory(db, res.id, embed);
                        if (embedded) {
                            await linkMemory(db, res.id, embed);
                        }
                    }
                    else {
                        // The reference row already existed from an earlier window — still
                        // supersede the decision row above; just reconfirm the reference.
                        touchMemory(db, res.id);
                    }
                    upgraded++;
                    continue;
                }
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
    if (allRedactions.length > 0) {
        const kinds = [...new Set(allRedactions)].sort();
        console.log(`[claude-nexus] redacted ${allRedactions.length} secret span(s): ${kinds.join(', ')}`);
    }
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
    // End-of-reflect() parallel-compact trigger. Fail-open: never throws, never
    // changes reflect()'s return value. On failure, leaves vcc_shrunk_path at
    // whatever value it already had (a failed re-compaction must not erase a
    // previously valid shrunk-copy pointer from an earlier successful run).
    try {
        const rawBytes = Buffer.byteLength(window.rawLines.join('\n'), 'utf-8');
        if (window.rawLines.length > 0 && opts.transcript_path && rawBytes > VCC_PARALLEL_COMPACT_BYTES) {
            const parallel = vcc.compactToParallelFile?.(opts.transcript_path, { timeoutMs: VCC_PARALLEL_COMPACT_TIMEOUT_MS });
            if (parallel?.ok && parallel.path) {
                db.prepare(`UPDATE sessions SET vcc_shrunk_path = ? WHERE session_id = ?`)
                    .run(parallel.path, opts.session_id);
            }
            else if (parallel && !parallel.ok) {
                console.error('[claude-nexus] vcc parallel-file compaction failed, vcc_shrunk_path left untouched:', parallel.error);
            }
        }
    }
    catch (err) {
        console.error('[claude-nexus] vcc parallel-file compaction trigger threw, vcc_shrunk_path left untouched:', err);
    }
    return {
        session_id: opts.session_id,
        project: opts.project,
        newLines: window.newLines,
        extracted: candidates.length,
        inserted,
        merged,
        upgraded,
        skipped: false,
        redactions: allRedactions.length,
        redaction_kinds: [...new Set(allRedactions)].sort(),
    };
}
//# sourceMappingURL=reflector.js.map