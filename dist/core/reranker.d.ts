/**
 * Cross-encoder reranking client for llama-swap / jina-reranker-v2-base-multilingual.
 * Endpoint, threshold and timeout come from extraction_models.yaml via getNexusConfig().
 *
 * Provider is llama-swap (D-001, D-008). The bespoke reranker-daemon spawn helper is
 * deleted; readiness is delegated to ensureLlamaSwapReady (D-008).
 * llama-swap forwards the request body and response verbatim — no OpenAI envelope,
 * no path rewriting. Response shape: [{index, score, document?}] (confirmed task-023).
 */
export interface RerankResult {
    index: number;
    score: number;
}
/**
 * Rerank `documents` by relevance to `query` via the local cross-encoder.
 * Returns results sorted by score descending, filtered to >= threshold, or
 * null on any error (disabled, daemon down, timeout, bad response) — non-fatal,
 * same contract as generateEmbedding(). Callers must fall back to their existing
 * ranking when this returns null.
 */
export declare function rerank(query: string, documents: string[], threshold?: number): Promise<RerankResult[] | null>;
//# sourceMappingURL=reranker.d.ts.map