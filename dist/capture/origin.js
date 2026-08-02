/**
 * Origin classifier — decides whether a session may write memories at all.
 *
 * Capture noise has three sources. Two are about WHO is running: book/article
 * processing (prose insights that belong in the Knowledge bases, not Nexus) and
 * distill-audit runs (the system generating memories about auditing its own
 * memories, a self-feeding loop). This module owns those. The third — file
 * content read during ordinary work — is a WHAT question, handled by the
 * tool-result scrubber in transcript.ts.
 *
 * Consumed by reflect() for live capture and by scripts/purge-origin.mjs for the
 * retroactive pass, so historical and going-forward rules cannot drift apart.
 */
import { readFileSync, existsSync } from 'fs';
const NOT_EXCLUDED = { excluded: false, reason: null };
/**
 * Origin markers live in the opening turns, but "opening" must be counted in
 * LINES, not bytes: Claude Code injects CLAUDE.md, recalled memories and system
 * reminders into the first turns, which can run to tens of KB before the marker
 * appears. A byte window silently fails open on exactly the sessions this
 * classifier exists to catch. The byte cap is only a backstop against a
 * pathological single line.
 */
const SCAN_LINES = 80;
const SCAN_CHARS_MAX = 2_000_000;
// Transcript lines are JSON-encoded, so a marker written as name="x" is stored
// as name=\"x\". Tolerate the optional backslash on both sides of the value.
const SCHEDULED_TASK_RE = /<scheduled-task\s+name=\\?"([^"\\]+)/g;
const COMMAND_NAME_RE = /<command-name>\\?\/?([a-z0-9:_-]+)<\/command-name>/gi;
const normalize = (s) => s.replace(/^\//, '').toLowerCase();
/** Commands arrive plugin-namespaced (`plugin:command`); the denylist may hold
 *  either form, so compare on the trailing segment. */
const bareName = (s) => normalize(s).split(':').pop() ?? '';
export function classifyOrigin(transcriptPath, cfg, env = process.env) {
    // Explicit opt-out wins and needs no transcript, so a wrapper script can
    // silence capture for anything (CI, manual bulk runs) without config edits.
    const optOut = env.NEXUS_NO_CAPTURE;
    if (optOut && optOut !== '0' && optOut.toLowerCase() !== 'false') {
        return { excluded: true, reason: 'NEXUS_NO_CAPTURE' };
    }
    let head;
    try {
        if (!existsSync(transcriptPath))
            return NOT_EXCLUDED;
        head = readFileSync(transcriptPath, 'utf-8')
            .split('\n', SCAN_LINES)
            .join('\n')
            .slice(0, SCAN_CHARS_MAX);
    }
    catch {
        // Fail OPEN. A classifier that cannot read the transcript must never be
        // the reason a real memory is silently lost.
        return NOT_EXCLUDED;
    }
    const tasks = (cfg.scheduled_tasks ?? []).map(normalize);
    for (const m of head.matchAll(SCHEDULED_TASK_RE)) {
        if (tasks.includes(normalize(m[1]))) {
            return { excluded: true, reason: `scheduled-task:${m[1]}` };
        }
    }
    // Match on the bare name, but report the full marker as observed, so the
    // reason still says which namespaced command actually triggered it.
    const commands = (cfg.commands ?? []).map(bareName);
    for (const m of head.matchAll(COMMAND_NAME_RE)) {
        const observed = normalize(m[1]);
        if (commands.includes(bareName(observed))) {
            return { excluded: true, reason: `command:/${observed}` };
        }
    }
    return NOT_EXCLUDED;
}
//# sourceMappingURL=origin.js.map