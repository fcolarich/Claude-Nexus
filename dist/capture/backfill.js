/**
 * Backfill — retroactive memory capture from sessions that predate the hooks.
 *
 * The live hooks only fire on sessions going forward. Every session already on
 * disk needs a one-time pass. Backfill selects un-analyzed sessions and runs
 * the same Reflector over each.
 *
 * There can be thousands of sessions — backfill is therefore SELECTIVE
 * (filters + a limit) and supports a dry run to preview the batch size before
 * spending LLM calls. Idempotent via the per-session reflection cursor.
 */
import { reflect } from './reflector.js';
import { exportAll } from './export.js';
/** Pick the sessions a backfill run would process. */
export function selectBackfillSessions(db, opts) {
    const minMessages = opts.minMessages ?? 8;
    const limit = opts.limit ?? 50;
    const where = ['jsonl_path IS NOT NULL', 'message_count >= @minMessages'];
    const params = { minMessages, limit };
    if (!opts.force)
        where.push('last_reflected_index = 0'); // only never-analyzed sessions
    if (opts.project) {
        where.push('project = @project');
        params.project = opts.project;
    }
    if (opts.since) {
        where.push('(last_active >= @since OR started_at >= @since)');
        params.since = opts.since;
    }
    return db.prepare(`
    SELECT session_id, jsonl_path, project, message_count FROM sessions
    WHERE ${where.join(' AND ')}
    ORDER BY last_active DESC
    LIMIT @limit
  `).all(params);
}
/**
 * Run the Reflector over selected past sessions. With dryRun, only reports how
 * many would be processed. `deps` lets tests inject a fake extractor/embedder.
 */
export async function backfillSessions(db, opts = {}, deps) {
    const sessions = selectBackfillSessions(db, opts);
    const result = {
        selected: sessions.length,
        processed: 0, inserted: 0, merged: 0, skippedNoSignal: 0,
        dryRun: !!opts.dryRun,
    };
    if (opts.dryRun)
        return result;
    for (const s of sessions) {
        if (opts.force) {
            db.prepare(`UPDATE sessions SET last_reflected_index = 0 WHERE session_id = ?`).run(s.session_id);
        }
        try {
            const r = await reflect(db, {
                session_id: s.session_id,
                transcript_path: s.jsonl_path,
                project: s.project,
            }, deps);
            result.processed++;
            result.inserted += r.inserted;
            result.merged += r.merged;
            if (r.skipped)
                result.skippedNoSignal++;
        }
        catch (err) {
            console.warn(`[backfill] session ${s.session_id} failed:`, err.message);
        }
    }
    if (result.inserted > 0)
        exportAll(db);
    return result;
}
//# sourceMappingURL=backfill.js.map