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
async function callAgentSdk(system, user, model, timeoutMs) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
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
    }
    finally {
        clearTimeout(timer);
    }
}
async function callOpenAICompatible(system, user, endpoint, model, temperature, timeoutMs) {
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
    if (!res.ok)
        throw new Error(`model endpoint HTTP ${res.status}`);
    const data = (await res.json());
    return data?.choices?.[0]?.message?.content ?? '';
}
/** Call the configured extraction model with a system + user prompt. */
export async function callModel(systemPrompt, userPrompt) {
    const cfg = getNexusConfig().extraction;
    try {
        if (cfg.provider === 'openai-compatible') {
            return await callOpenAICompatible(systemPrompt, userPrompt, cfg.endpoint, cfg.model, cfg.temperature, cfg.timeout_ms);
        }
        return await callAgentSdk(systemPrompt, userPrompt, cfg.model, cfg.timeout_ms);
    }
    catch (err) {
        console.warn(`[llm] call failed (${cfg.provider}/${cfg.model}):`, err.message);
        return '';
    }
}
//# sourceMappingURL=llm.js.map