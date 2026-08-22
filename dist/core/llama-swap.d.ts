/**
 * llama-swap readiness module for nexus — shared by embedder and reranker.
 *
 * Replaces (deletes) two bespoke spawn helpers that used to live in
 * embeddings.ts and reranker.ts (Ollama-spawn and reranker-daemon-spawn).
 *
 * Structurally modelled on uber-db src/llama-swap-client.ts (read-only reference).
 * No cross-repo import; no shared package.
 *
 * Contract (D-007, D-008):
 *   - Two-tier readiness: GET /v1/models (pool liveness) → caller warmup (model warmth)
 *   - NEVER throws; resolves false on unrecoverable failure so callers null-degrade
 *   - Memo is PROMISE-valued so two concurrent first calls don't both spawn llama-swap
 *   - force:true bypasses memo entirely; mid-run TTL eviction then stays visible
 *   - Warmup fail → false (live proxy + dead model is not ready; returning true would
 *     convert a clean degrade into a per-call timeout storm)
 */
/** Return scheme+host+port of the llama-swap proxy, derived from embedding.endpoint. */
export declare function llamaSwapBase(): string;
/**
 * Ensure the llama-swap proxy is up AND the named model is warm.
 *
 * Sequence:
 *   1. GET {base}/v1/models — pool liveness (loads nothing, works for OpenAI and
 *      non-OpenAI upstreams alike per D-007)
 *   2. If proxy absent: spawn llama-swap (detached, fire-and-forget) then poll
 *      /v1/models until budgetMs expires
 *   3. Call warmup() on the model's own route — proxy live ≠ model warm
 *   4. Return warmup result; resolve false if any unrecoverable step fails
 */
export declare function ensureLlamaSwapReady(model: string, warmup: () => Promise<boolean>, opts?: {
    force?: boolean;
    budgetMs?: number;
}): Promise<boolean>;
//# sourceMappingURL=llama-swap.d.ts.map