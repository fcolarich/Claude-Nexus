/**
 * Cross-encoder reranking client for the local-reranker HTTP daemon
 * (jina-reranker-v2-base-multilingual via FastEmbed). Endpoint, threshold and
 * timeout come from extraction_models.yaml via getNexusConfig() — see
 * src/core/config.ts.
 */
import { spawn } from 'child_process';
import { getNexusConfig } from './config.js';
/** Extract base URL (scheme+host+port) from the configured rerank endpoint. */
function rerankerBaseUrl() {
    try {
        const u = new URL(getNexusConfig().reranker.endpoint);
        return `${u.protocol}//${u.host}`;
    }
    catch {
        return 'http://127.0.0.1:8931';
    }
}
let spawnAttempted = false;
/**
 * If the reranker isn't responding, spawn `python <script_path> --http` and wait
 * up to 30s for it to come up. No-ops if the reranker is disabled in config, or
 * if a spawn was already attempted this process lifetime (never repeat-spawn on
 * every call — mirrors ensureOllamaRunning in embeddings.ts).
 */
export async function ensureRerankerRunning() {
    const cfg = getNexusConfig().reranker;
    if (!cfg.enabled || spawnAttempted)
        return;
    const base = rerankerBaseUrl();
    try {
        const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
        if (r.ok)
            return;
    }
    catch { /* not running — fall through to spawn */ }
    spawnAttempted = true;
    console.error('[reranker] local-reranker not running — spawning HTTP daemon');
    const proc = spawn('python', [cfg.script_path, '--http'], { detached: true, stdio: 'ignore', shell: false });
    proc.unref();
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
            const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
            if (r.ok) {
                console.error('[reranker] local-reranker started');
                return;
            }
        }
        catch { /* still starting */ }
    }
    console.warn('[reranker] local-reranker did not start within 30s — proceeding without reranking');
}
/**
 * Rerank `documents` by relevance to `query` via the local cross-encoder.
 * Returns results sorted by score descending, filtered to >= threshold, or
 * null on any error (disabled, daemon down, timeout, bad response) — non-fatal,
 * same contract as generateEmbedding(). Callers must fall back to their existing
 * ranking when this returns null.
 */
export async function rerank(query, documents, threshold) {
    const cfg = getNexusConfig().reranker;
    if (!cfg.enabled || documents.length === 0)
        return null;
    await ensureRerankerRunning();
    try {
        const response = await fetch(cfg.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, documents, threshold: threshold ?? cfg.threshold }),
            signal: AbortSignal.timeout(cfg.timeout_ms),
        });
        if (!response.ok) {
            console.warn(`[reranker] endpoint returned HTTP ${response.status}`);
            return null;
        }
        const data = (await response.json());
        if (!Array.isArray(data))
            return null;
        return data.map(d => ({ index: d.index, score: d.score }));
    }
    catch {
        // Silently swallow — the reranker daemon may simply not be running
        return null;
    }
}
//# sourceMappingURL=reranker.js.map