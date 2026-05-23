/**
 * nexus-load runner — the SessionStart hook entry point.
 *
 * Reads the SessionStart payload from stdin, recalls budgeted memories for the
 * project, and emits them as `additionalContext`. Synchronous and DB-direct —
 * no Nexus web server required. Must stay fast: it runs on every session start.
 *
 * Registered directly as the hook command (no wrapper): the hook needs the
 * recall output on stdout, so it cannot be a detached spawn.
 *
 * Usage: node dist/capture/load-runner.js   (payload on stdin)
 */
import { openDatabase } from '../core/database.js';
import { recallMemories } from '../core/recall.js';
/** Project slug from a cwd — same convention as the indexer (kept inline to
 *  avoid pulling the indexer module tree into this hot-path hook). */
function cwdToProjectSlug(cwd) {
    const slug = cwd.replace(/[:\\/]/g, '-').replace(/_/g, '-').replace(/^-+|-+$/g, '');
    return slug.length >= 3 ? slug : null;
}
async function readStdin() {
    let input = '';
    process.stdin.setEncoding('utf-8');
    for await (const chunk of process.stdin)
        input += chunk;
    return input;
}
async function main() {
    let payload = {};
    try {
        payload = JSON.parse((await readStdin()) || '{}');
    }
    catch { /* malformed */ }
    const project = cwdToProjectSlug(payload.cwd || process.cwd()) ?? null;
    const db = openDatabase(process.env.NEXUS_DB);
    try {
        const result = recallMemories(db, { project });
        if (result.markdown.trim()) {
            process.stdout.write(JSON.stringify({
                hookSpecificOutput: {
                    hookEventName: 'SessionStart',
                    additionalContext: result.markdown,
                },
            }));
        }
    }
    finally {
        db.close();
    }
}
// Recall is best-effort — a failure must never block session start.
main().catch(() => { }).finally(() => process.exit(0));
//# sourceMappingURL=load-runner.js.map