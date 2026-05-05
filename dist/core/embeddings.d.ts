/**
 * Embedding generation via Ollama HTTP API.
 * Model: mxbai-embed-large (1024-dimensional output)
 * Endpoint: http://127.0.0.1:11434
 */
/**
 * Generate an embedding for the given text using Ollama.
 * Returns null on any error (Ollama down, model missing, etc.) — non-fatal.
 */
export declare function generateEmbedding(text: string): Promise<Float32Array | null>;
//# sourceMappingURL=embeddings.d.ts.map