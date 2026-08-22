/**
 * Embedding generation for vector search.
 * Endpoint, model, dimensions and timeout come from extraction_models.yaml
 * via getNexusConfig() — see src/core/config.ts.
 *
 * Provider is llama-swap (D-001). Ollama is retired. Response shape is OpenAI:
 *   { object: 'list', data: [{ embedding: number[] }] }
 */
/**
 * Ensure the embedding model is loaded before a bulk pass.
 * Delegates to ensureLlamaSwapReady — two-tier check: proxy liveness then
 * model warmth. Returns true if ready, false if unavailable.
 */
export declare function ensureEmbeddingModelReady(): Promise<boolean>;
/**
 * Generate an embedding for the given text.
 * On HTTP 500 (mid-run cold-swap): waits 3s, forces a fresh readiness check,
 * then retries once. Returns null on any persistent error — non-fatal.
 * Embedding coverage is surfaced by getStats() so the silent path is observable.
 */
export declare function generateEmbedding(text: string): Promise<Float32Array | null>;
//# sourceMappingURL=embeddings.d.ts.map