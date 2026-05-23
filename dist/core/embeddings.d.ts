/**
 * Embedding generation for vector search.
 * Endpoint, model, dimensions and timeout come from extraction_models.yaml
 * via getNexusConfig() — see src/core/config.ts.
 */
/**
 * Ensure the embedding model is loaded before a bulk pass.
 * Ollama loads models on demand but takes 5–30s on a cold start. Sending one
 * warmup request with a long timeout lets us wait it out once rather than
 * flooding the bulk loop with 500s while the model loads.
 * Returns true if the model is ready, false if unavailable.
 */
export declare function ensureEmbeddingModelReady(): Promise<boolean>;
/**
 * Generate an embedding for the given text.
 * Retries once on HTTP 500 (model mid-load) after a short wait.
 * Returns null on any persistent error — non-fatal.
 * Embedding coverage is surfaced by getStats() so the silent path is observable.
 */
export declare function generateEmbedding(text: string): Promise<Float32Array | null>;
//# sourceMappingURL=embeddings.d.ts.map