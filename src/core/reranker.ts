/**
 * Cross-encoder reranking client for llama-swap / jina-reranker-v2-base-multilingual.
 * Endpoint, threshold and timeout come from extraction_models.yaml via getNexusConfig().
 *
 * Provider is llama-swap (D-001, D-008). The bespoke reranker-daemon spawn helper is
 * deleted; readiness is delegated to ensureLlamaSwapReady (D-008).
 * llama-swap forwards the request body and response verbatim — no OpenAI envelope,
 * no path rewriting. Response shape: [{index, score, document?}] (confirmed task-023).
 */

import { getNexusConfig } from './config.js';
import { ensureLlamaSwapReady } from './llama-swap.js';

export interface RerankResult {
	index: number;
	score: number;
}

/**
 * One rerank call to confirm the model is loaded and responsive.
 * Passed as the warmup callback to ensureLlamaSwapReady.
 */
async function warmupRerank(): Promise<boolean> {
	const cfg = getNexusConfig().reranker;
	try {
		const response = await fetch(cfg.endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query: 'warmup', documents: ['warmup'], threshold: 0 }),
			signal: AbortSignal.timeout(60_000), // wait up to 60s for cold load
		});
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * Rerank `documents` by relevance to `query` via the local cross-encoder.
 * Returns results sorted by score descending, filtered to >= threshold, or
 * null on any error (disabled, daemon down, timeout, bad response) — non-fatal,
 * same contract as generateEmbedding(). Callers must fall back to their existing
 * ranking when this returns null.
 */
export async function rerank(
	query: string,
	documents: string[],
	threshold?: number
): Promise<RerankResult[] | null> {
	const cfg = getNexusConfig().reranker;
	if (!cfg.enabled || documents.length === 0) return null;

	const ready = await ensureLlamaSwapReady(cfg.model, warmupRerank);
	if (!ready) return null;

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

		const data = (await response.json()) as { index: number; score: number; document?: string }[];
		if (!Array.isArray(data)) return null;

		return data.map(d => ({ index: d.index, score: d.score }));
	} catch {
		// Silently swallow — llama-swap may simply not be running
		return null;
	}
}
