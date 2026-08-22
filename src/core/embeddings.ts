/**
 * Embedding generation for vector search.
 * Endpoint, model, dimensions and timeout come from extraction_models.yaml
 * via getNexusConfig() — see src/core/config.ts.
 *
 * Provider is llama-swap (D-001). Ollama is retired. Response shape is OpenAI:
 *   { object: 'list', data: [{ embedding: number[] }] }
 */

import { getNexusConfig } from './config.js';
import { ensureLlamaSwapReady } from './llama-swap.js';

/**
 * One embedding call to confirm the model is loaded and responsive.
 * Passed as the warmup callback to ensureLlamaSwapReady.
 */
async function warmupEmbed(): Promise<boolean> {
	const cfg = getNexusConfig().embedding;
	try {
		const response = await fetch(cfg.endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: cfg.model, input: 'warmup' }),
			signal: AbortSignal.timeout(60_000), // wait up to 60s for cold load
		});
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * Ensure the embedding model is loaded before a bulk pass.
 * Delegates to ensureLlamaSwapReady — two-tier check: proxy liveness then
 * model warmth. Returns true if ready, false if unavailable.
 */
export async function ensureEmbeddingModelReady(): Promise<boolean> {
	const cfg = getNexusConfig().embedding;
	return ensureLlamaSwapReady(cfg.model, warmupEmbed);
}

/**
 * Generate an embedding for the given text.
 * On HTTP 500 (mid-run cold-swap): waits 3s, forces a fresh readiness check,
 * then retries once. Returns null on any persistent error — non-fatal.
 * Embedding coverage is surfaced by getStats() so the silent path is observable.
 */
export async function generateEmbedding(text: string): Promise<Float32Array | null> {
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
					// Mid-run cold-swap recovery — wait for model reload, then retry once.
					// force:true bypasses the memo so the new readiness state is picked up.
					await new Promise(r => setTimeout(r, 3000));
					await ensureLlamaSwapReady(cfg.model, warmupEmbed, { force: true });
					continue;
				}
				console.warn(`[embeddings] ${cfg.provider} returned HTTP ${response.status}`);
				return null;
			}

			const data = (await response.json()) as { object: string; data: { embedding: number[] }[] };
			if (!Array.isArray(data.data) || data.data.length === 0 || data.data[0].embedding.length === 0) {
				console.warn('[embeddings] embedding endpoint returned empty result');
				return null;
			}

			return new Float32Array(data.data[0].embedding);
		} catch {
			// Silently swallow — the embedding model may simply not be running
			return null;
		}
	}
	return null;
}
