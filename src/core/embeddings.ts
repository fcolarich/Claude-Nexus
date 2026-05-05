/**
 * Embedding generation via Ollama HTTP API.
 * Model: mxbai-embed-large (1024-dimensional output)
 * Endpoint: http://127.0.0.1:11434
 */

const OLLAMA_URL = 'http://127.0.0.1:11434/api/embeddings';
const EMBED_MODEL = 'mxbai-embed-large';

/**
 * Generate an embedding for the given text using Ollama.
 * Returns null on any error (Ollama down, model missing, etc.) — non-fatal.
 */
export async function generateEmbedding(text: string): Promise<Float32Array | null> {
  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.warn(`[embeddings] Ollama returned HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { embedding?: number[] };
    if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
      console.warn('[embeddings] Ollama returned empty embedding');
      return null;
    }

    return new Float32Array(data.embedding);
  } catch (err) {
    // Silently swallow — Ollama may simply not be running
    return null;
  }
}
