/**
 * Cross-encoder reranking client for the local-reranker HTTP daemon
 * (jina-reranker-v2-base-multilingual via FastEmbed). Endpoint, threshold and
 * timeout come from extraction_models.yaml via getNexusConfig() — see
 * src/core/config.ts.
 */
export interface RerankResult {
    index: number;
    score: number;
}
/**
 * If the reranker isn't responding, spawn `python <script_path> --http` and wait
 * up to 30s for it to come up. No-ops if the reranker is disabled in config, or
 * if a spawn was already attempted this process lifetime (never repeat-spawn on
 * every call — mirrors ensureOllamaRunning in embeddings.ts).
 */
export declare function ensureRerankerRunning(): Promise<void>;
/**
 * Rerank `documents` by relevance to `query` via the local cross-encoder.
 * Returns results sorted by score descending, filtered to >= threshold, or
 * null on any error (disabled, daemon down, timeout, bad response) — non-fatal,
 * same contract as generateEmbedding(). Callers must fall back to their existing
 * ranking when this returns null.
 */
export declare function rerank(query: string, documents: string[], threshold?: number): Promise<RerankResult[] | null>;
//# sourceMappingURL=reranker.d.ts.map