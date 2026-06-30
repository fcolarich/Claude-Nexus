/**
 * Embedding generation for vector search.
 * Endpoint, model, dimensions and timeout come from extraction_models.yaml
 * via getNexusConfig() — see src/core/config.ts.
 */
import { spawn } from 'child_process';
import { getNexusConfig } from './config.js';
/** Extract base URL (scheme+host+port) from the configured embedding endpoint. */
function ollamaBaseUrl() {
    try {
        const u = new URL(getNexusConfig().embedding.endpoint);
        return `${u.protocol}//${u.host}`;
    }
    catch {
        return 'http://127.0.0.1:11434';
    }
}
/**
 * If embedding provider is ollama and Ollama isn't responding, spawn `ollama serve`
 * and wait up to 30s for it to come up. No-ops for non-ollama providers.
 */
async function ensureOllamaRunning() {
    if (getNexusConfig().embedding.provider !== 'ollama')
        return;
    const base = ollamaBaseUrl();
    try {
        const r = await fetch(base, { signal: AbortSignal.timeout(1000) });
        if (r.ok)
            return;
    }
    catch { /* not running — fall through to spawn */ }
    console.error('[embeddings] Ollama not running — spawning `ollama serve`');
    const proc = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', shell: false });
    proc.unref();
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
            const r = await fetch(base, { signal: AbortSignal.timeout(1000) });
            if (r.ok) {
                console.error('[embeddings] Ollama started');
                return;
            }
        }
        catch { /* still starting */ }
    }
    console.warn('[embeddings] Ollama did not start within 30s — proceeding without embeddings');
}
/**
 * Ensure the embedding model is loaded before a bulk pass.
 * Ollama loads models on demand but takes 5–30s on a cold start. Sending one
 * warmup request with a long timeout lets us wait it out once rather than
 * flooding the bulk loop with 500s while the model loads.
 * Returns true if the model is ready, false if unavailable.
 */
export async function ensureEmbeddingModelReady() {
    await ensureOllamaRunning();
    const cfg = getNexusConfig().embedding;
    try {
        const response = await fetch(cfg.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: cfg.model, input: 'warmup' }),
            signal: AbortSignal.timeout(60_000), // wait up to 60s for cold load
        });
        return response.ok;
    }
    catch {
        return false;
    }
}
/**
 * Generate an embedding for the given text.
 * Retries once on HTTP 500 (model mid-load) after a short wait.
 * Returns null on any persistent error — non-fatal.
 * Embedding coverage is surfaced by getStats() so the silent path is observable.
 */
export async function generateEmbedding(text) {
    const cfg = getNexusConfig().embedding;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await fetch(cfg.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: cfg.model, input: text.slice(0, 1200) }),
                signal: AbortSignal.timeout(cfg.timeout_ms),
            });
            if (!response.ok) {
                if (response.status === 500 && attempt === 0) {
                    // Model may still be loading — wait 3s and retry once
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }
                console.warn(`[embeddings] ${cfg.provider} returned HTTP ${response.status}`);
                return null;
            }
            const data = (await response.json());
            if (!Array.isArray(data.embeddings) || data.embeddings.length === 0 || data.embeddings[0].length === 0) {
                console.warn('[embeddings] embedding endpoint returned empty result');
                return null;
            }
            return new Float32Array(data.embeddings[0]);
        }
        catch {
            // Silently swallow — the embedding model may simply not be running
            return null;
        }
    }
    return null;
}
//# sourceMappingURL=embeddings.js.map