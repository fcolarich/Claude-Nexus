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
/** Project slug from a cwd — mirrors the indexer convention; collapses git
 *  worktrees onto their parent project so recall finds the main checkout's memories. */
function cwdToProjectSlug(cwd) {
    const slug = cwd
        .replace(/[:\\/ ._]/g, '-')
        .replace(/-+(claude-)?worktrees?-.*$/, '')
        .replace(/^-+|-+$/g, '');
    return slug.length >= 3 ? slug : null;
}
async function readStdin() {
    let input = '';
    process.stdin.setEncoding('utf-8');
    for await (const chunk of process.stdin)
        input += chunk;
    return input;
}
const stateDir = join(homedir(), '.claude', 'memories', '.recall-state');
function loadInjected(sessionId) {
    try {
        const ids = JSON.parse(readFileSync(join(stateDir, `${sessionId}.json`), 'utf-8'));
        return new Set(Array.isArray(ids) ? ids : []);
    }
    catch {
        return new Set();
    }
}
function saveInjected(sessionId, ids) {
    try {
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(join(stateDir, `${sessionId}.json`), JSON.stringify([...ids]));
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
    const project = cwdToProjectSlug(payload.cwd || process.cwd()) ?? null;
    const injected = sessionId ? loadInjected(sessionId) : new Set();
    const db = openDatabase(process.env.NEXUS_DB);
    try {
        const result = await recallByQuery(db, {
            project,
            query: prompt,
            limit: 5,
            excludeIds: [...injected],
        });
        if (result.items.length === 0 || !result.markdown.trim())
            return;
        for (const i of result.items)
            injected.add(i.memory.id);
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