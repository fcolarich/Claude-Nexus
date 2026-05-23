/**
 * Shared LLM client for the capture + distill pipelines.
 *
 * Provider-aware, driven by `extraction` in extraction_models.yaml:
 *   claude-agent-sdk  — Haiku via the local `claude` CLI (OAuth, no API key)
 *   openai-compatible — a local llama.cpp / Ollama /v1 chat endpoint
 *
 * Returns '' on any failure (logged, non-throwing) so callers degrade gracefully.
 */
/** Call the configured extraction model with a system + user prompt. */
export declare function callModel(systemPrompt: string, userPrompt: string): Promise<string>;
//# sourceMappingURL=llm.d.ts.map