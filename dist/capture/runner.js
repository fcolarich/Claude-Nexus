/**
 * Reflector runner — standalone entry point spawned (detached) by the
 * nexus-capture hook. Does not depend on the Nexus web server.
 *
 * Usage: node dist/capture/runner.js <session_id> <transcript_path> [cwd]
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { openDatabase, initializeSchema } from '../core/database.js';
import { resolveProjectSlug } from '../core/project-root.js';
import { reflect } from './reflector.js';
import { exportAll } from './export.js';
import { readTranscriptWindow } from './transcript.js';
import { getMemory, recordFeedback } from '../core/memories.js';
import { judgeMemoryUsefulness } from './feedback-judge.js';
const defaultStateDir = join(homedir(), '.claude', 'memories', '.recall-state');
function readStateFile(sessionId, stateDir) {
    try {
        const raw = JSON.parse(readFileSync(join(stateDir, `${sessionId}.json`), 'utf-8'));
        if (!Array.isArray(raw))
            return null;
        return raw.filter((e) => e && typeof e.id === 'string' && typeof e.evaluated === 'boolean');
    }
    catch {
        return null;
    }
}
function writeStateFile(sessionId, stateDir, entries) {
    try {
        writeFileSync(join(stateDir, `${sessionId}.json`), JSON.stringify(entries));
    }
    catch { /* best-effort */ }
}
/**
 * Retrospective usefulness pass: reads the session's recall-state file, judges
 * any not-yet-evaluated injected memories against the full transcript, records
 * feedback, and marks those ids evaluated so a later Stop/PreCompact/SessionEnd
 * firing in the same session doesn't re-judge them.
 *
 * Best-effort by design (mirrors reflect()): a missing state file, an empty
 * unevaluated set, or a malformed judge response are all silent no-ops — this
 * runs in the same detached process that must never fail loudly. `haikuFn` is
 * injectable for tests; omit it in production to use judgeMemoryUsefulness's
 * own default (callModel).
 */
export async function runFeedbackPass(db, sessionId, transcriptText, stateDir = defaultStateDir, haikuFn) {
    const entries = readStateFile(sessionId, stateDir);
    if (!entries || entries.length === 0)
        return;
    const unevaluated = entries.filter((e) => !e.evaluated);
    if (unevaluated.length === 0)
        return;
    const judgeMemories = unevaluated
        .map((e) => {
        const mem = getMemory(db, e.id);
        return mem ? { id: mem.id, title: mem.title, body: mem.body } : null;
    })
        .filter((m) => m !== null);
    const verdicts = judgeMemories.length === 0
        ? []
        : haikuFn
            ? await judgeMemoryUsefulness(transcriptText, judgeMemories, haikuFn)
            : await judgeMemoryUsefulness(transcriptText, judgeMemories);
    const verdictById = new Map(verdicts.map((v) => [v.id, v.helped]));
    for (const entry of unevaluated) {
        const helped = verdictById.get(entry.id);
        if (helped !== undefined) {
            recordFeedback(db, entry.id, helped);
            entry.evaluated = true;
        }
        else if (!judgeMemories.some((m) => m.id === entry.id)) {
            // No memory row (deleted/pruned) — mark evaluated so it's never retried
            // against a dead id, matching the design's error-handling rule.
            entry.evaluated = true;
        }
        // else: judge ran but produced no verdict for this id — leave unevaluated,
        // retried on the next Stop/PreCompact/SessionEnd firing in this session.
    }
    writeStateFile(sessionId, stateDir, entries);
}
async function main() {
    const [sessionId, transcriptPath, cwd] = process.argv.slice(2);
    if (!sessionId || !transcriptPath) {
        console.error('[nexus-reflect] usage: runner.js <session_id> <transcript_path> [cwd]');
        process.exit(1);
    }
    process.env.OTEL_RESOURCE_ATTRIBUTES = 'service.namespace=nexus,automation=nexus';
    const project = cwd ? resolveProjectSlug(cwd) : null;
    const db = openDatabase();
    initializeSchema(db);
    try {
        const result = await reflect(db, {
            session_id: sessionId,
            transcript_path: transcriptPath,
            project,
            cwd,
        });
        if (!result.skipped && (result.inserted > 0 || result.merged > 0)) {
            const exp = exportAll(db);
            console.error(`[nexus-reflect] ${JSON.stringify({ ...result, exported: exp.files })}`);
        }
        else {
            console.error(`[nexus-reflect] ${JSON.stringify(result)}`);
        }
        // Retrospective usefulness pass — full transcript (index 0) for hindsight,
        // not reflect()'s new-lines-only window. Best-effort: any failure here must
        // never surface past this try block.
        try {
            const window = readTranscriptWindow(transcriptPath, 0);
            if (window.text) {
                await runFeedbackPass(db, sessionId, window.text);
            }
        }
        catch (err) {
            console.error('[nexus-feedback] error:', err);
        }
    }
    finally {
        db.close();
    }
}
// Guard so importing this module (e.g. runner.test.ts importing runFeedbackPass)
// never triggers the CLI entrypoint — only running it directly does.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((err) => {
        console.error('[nexus-reflect] error:', err);
        process.exit(1);
    });
}
//# sourceMappingURL=runner.js.map