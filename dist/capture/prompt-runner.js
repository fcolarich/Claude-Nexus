/**
 * nexus prompt-runner — the UserPromptSubmit hook entry point.
 *
 * Reads the UserPromptSubmit payload from stdin, embeds the user's prompt,
 * recalls the few most-relevant memories (vector similarity above a floor),
 * dedups against memories already injected this session, and emits them as
 * `additionalContext`. Best-effort: any failure exits 0 with no output and
 * never blocks the prompt.
 *
 * Usage: node dist/capture/prompt-runner.js   (payload on stdin)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { openDatabase } from '../core/database.js';
import { recallByQuery } from '../core/recall.js';
import { getNexusConfig } from '../core/config.js';
import { resolveProjectSlug } from '../core/project-root.js';
async function readStdin() {
    let input = '';
    process.stdin.setEncoding('utf-8');
    for await (const chunk of process.stdin)
        input += chunk;
    return input;
}
const defaultStateDir = join(homedir(), '.claude', 'memories', '.recall-state');
/**
 * Loads the per-session recall-state file as a Map<memoryId, evaluated>.
 * Transparently migrates the legacy flat string[] format (pre-feedback-judge)
 * to {id, evaluated:false} entries. Missing/corrupt files return an empty map
 * — best-effort, matches the rest of this hook's failure handling.
 */
export function loadInjected(sessionId, stateDir = defaultStateDir) {
    try {
        const raw = JSON.parse(readFileSync(join(stateDir, `${sessionId}.json`), 'utf-8'));
        const result = new Map();
        if (!Array.isArray(raw))
            return result;
        for (const entry of raw) {
            if (typeof entry === 'string') {
                result.set(entry, false); // legacy format
            }
            else if (entry && typeof entry.id === 'string') {
                result.set(entry.id, entry.evaluated === true);
            }
        }
        return result;
    }
    catch {
        return new Map();
    }
}
export function saveInjected(sessionId, ids, stateDir = defaultStateDir) {
    try {
        mkdirSync(stateDir, { recursive: true });
        const entries = [...ids.entries()].map(([id, evaluated]) => ({ id, evaluated }));
        writeFileSync(join(stateDir, `${sessionId}.json`), JSON.stringify(entries));
    }
    catch { /* best-effort */ }
}
async function main() {
    let payload = {};
    try {
        payload = JSON.parse((await readStdin()) || '{}');
    }
    catch { /* malformed */ }
    const prompt = (payload.prompt || '').trim();
    const sessionId = payload.session_id || '';
    const cfg = getNexusConfig().recall;
    // Gate 1: skip trivial prompts ("yes", "ok", "do it") — nothing to match on.
    if (prompt.split(/\s+/).filter(Boolean).length < cfg.min_words)
        return;
    const project = resolveProjectSlug(payload.cwd || process.cwd()) ?? null;
    const injected = sessionId ? loadInjected(sessionId) : new Map();
    const db = openDatabase(process.env.NEXUS_DB);
    try {
        const result = await recallByQuery(db, {
            project,
            query: prompt,
            limit: 5,
            excludeIds: [...injected.keys()],
        });
        if (result.items.length === 0 || !result.markdown.trim())
            return;
        for (const i of result.items)
            injected.set(i.memory.id, false);
        if (sessionId)
            saveInjected(sessionId, injected);
        process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'UserPromptSubmit',
                additionalContext: result.markdown,
            },
        }));
    }
    finally {
        db.close();
    }
}
// Recall is best-effort — a failure must never block the prompt.
main().catch(() => { }).finally(() => process.exit(0));
//# sourceMappingURL=prompt-runner.js.map