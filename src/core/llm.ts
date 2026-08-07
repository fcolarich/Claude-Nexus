/**
 * Shared LLM client for the capture + distill pipelines.
 *
 * Provider-aware, driven by `extraction` in extraction_models.yaml:
 *   claude-agent-sdk  — Haiku via the local `claude` CLI (OAuth, no API key)
 *   openai-compatible — a local llama.cpp / Ollama /v1 chat endpoint
 *
 * Returns '' on any failure (logged, non-throwing) so callers degrade gracefully.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { getNexusConfig } from './config.js';

async function callAgentSdk(system: string, user: string, model: string, timeoutMs: number): Promise<string> {
  const ac = new AbortController();

  const drain = async (): Promise<string> => {
    let result = '';
    for await (const message of query({
      prompt: user,
      options: {
        model,
        systemPrompt: system,
        allowedTools: [],
        maxTurns: 1,
        settingSources: [],
        abortController: ac,
      },
    })) {
      if (message.type === 'result' && message.subtype === 'success') {
        result = message.result;
      }
    }
    return result;
  };

  // The abortController alone does not bound this call. When the underlying
  // `claude` CLI wedges, the async iterator simply stops yielding — it never
  // rejects — so ac.abort() fires into a void and `for await` waits forever. A
  // 2026-08-02 distill sweep sat on one such call for 1800s against this very
  // 120s budget. Racing a hard timer guarantees a return on schedule; callModel
  // then degrades to ''. The abort is still issued first so an SDK that is merely
  // slow, rather than wedged, gets the chance to tear its subprocess down.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(new Error(`agent-sdk call exceeded ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const drained = drain();
  drained.catch(() => {});  // race may settle via expiry; swallow the orphaned rejection

  try {
    return await Promise.race([drained, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAICompatible(
  system: string, user: string, endpoint: string, model: string, temperature: number, timeoutMs: number
): Promise<string> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`model endpoint HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data?.choices?.[0]?.message?.content ?? '';
}

/** Call the configured extraction model with a system + user prompt. */
export async function callModel(systemPrompt: string, userPrompt: string): Promise<string> {
  const cfg = getNexusConfig().extraction;
  try {
    if (cfg.provider === 'openai-compatible') {
      return await callOpenAICompatible(systemPrompt, userPrompt, cfg.endpoint, cfg.model, cfg.temperature, cfg.timeout_ms);
    }
    return await callAgentSdk(systemPrompt, userPrompt, cfg.model, cfg.timeout_ms);
  } catch (err) {
    console.warn(`[llm] call failed (${cfg.provider}/${cfg.model}):`, (err as Error).message);
    return '';
  }
}
