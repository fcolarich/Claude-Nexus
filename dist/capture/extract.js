/**
 * Memory extractor — turns a condensed transcript into typed memory candidates.
 *
 * Provider-aware: `claude-agent-sdk` (default — Haiku via the local `claude` CLI,
 * OAuth auth, no API key) or `openai-compatible` (a local llama.cpp / Ollama /v1
 * endpoint). Provider + model come from extraction_models.yaml.
 */
import { callModel } from '../core/llm.js';
const MEMORY_TYPES = new Set(['preference', 'convention', 'failure', 'correction', 'decision', 'insight', 'tool_quirk', 'reference', 'handoff']);
const DECAY_CLASSES = new Set(['stable', 'architecture', 'api_contract', 'implementation']);
const SCOPES = new Set(['global', 'shared', 'project']);
const MAX_CANDIDATES = 20;
const SYSTEM_PROMPT = `You extract durable, reusable MEMORIES from a Claude Code coding-assistant session transcript.

A memory is a fact worth recalling in a FUTURE, unrelated session. Extract ONLY durable knowledge. Do NOT extract ephemeral task state, step-by-step narration, or anything a reader could derive by reading the code.

memory_type — pick one:
- preference  — how the user wants work done (style, tone, workflow, communication)
- convention  — a project or codebase rule/pattern to follow
- failure     — an approach that broke or proved wrong; avoid repeating it
- correction  — an explicit user correction of the assistant's behaviour
- decision    — an architectural/design decision and its rationale
- insight     — a non-obvious discovered fact about the system or domain
- tool_quirk  — surprising behaviour of a tool, command, or environment
- reference   — a pointer to where information lives (external system, doc, dashboard)
- handoff     — end-of-session state: what was done and what comes next

decay_class — how fast the memory goes stale:
- stable         — preferences, conventions; rarely change
- architecture   — design decisions; change slowly
- api_contract   — interface/contract facts; medium pace
- implementation — current implementation details/state; change fast

scope:
- project — specific to this project (default)
- global  — a cross-project user preference or universal convention
- shared  — team-level knowledge

For each memory write:
- title: a short noun phrase, under 60 characters
- body: 1-4 sentences. State the durable lesson AND its WHY. Self-contained — must read clearly with no other context.
- confidence: 0.0-1.0. Explicit user statements = high; patterns you inferred = lower.
- tags: 2-5 short lowercase keywords.

Rules:
- Prefer 0 memories over noise. An empty array is the correct answer for a session with nothing durable.
- Never invent. Extract only what the transcript supports.
- One memory per distinct fact — merge duplicates.
- Output STRICT JSON ONLY: an array of objects with keys title, body, memory_type, scope, decay_class, confidence, tags. No prose, no markdown fences.`;
/** Extract the first top-level JSON array from a model response and validate it. */
export function parseCandidates(raw) {
    if (!raw || !raw.trim())
        return [];
    let parsed;
    try {
        parsed = JSON.parse(raw.trim());
    }
    catch {
        const match = raw.match(/\[[\s\S]*\]/);
        if (!match)
            return [];
        try {
            parsed = JSON.parse(match[0]);
        }
        catch {
            return [];
        }
    }
    if (!Array.isArray(parsed))
        return [];
    const out = [];
    for (const item of parsed) {
        if (!item || typeof item !== 'object')
            continue;
        const o = item;
        const title = typeof o.title === 'string' ? o.title.trim() : '';
        const body = typeof o.body === 'string' ? o.body.trim() : '';
        if (!title || !body)
            continue;
        if (!MEMORY_TYPES.has(o.memory_type))
            continue;
        const scope = SCOPES.has(o.scope) ? o.scope : 'project';
        const decay_class = DECAY_CLASSES.has(o.decay_class) ? o.decay_class : 'implementation';
        let confidence = typeof o.confidence === 'number' ? o.confidence : 0.6;
        confidence = Math.max(0, Math.min(1, confidence));
        const tags = Array.isArray(o.tags)
            ? o.tags.filter(t => typeof t === 'string').map(t => t.toLowerCase()).slice(0, 5)
            : [];
        out.push({ title: title.slice(0, 120), body, memory_type: o.memory_type, scope, decay_class, confidence, tags });
        if (out.length >= MAX_CANDIDATES)
            break;
    }
    return out;
}
/** Default extractor — used by the Reflector unless a fake is injected. */
export async function extractMemories(condensed, ctx) {
    if (!condensed.trim())
        return [];
    const userPrompt = `Project: ${ctx.project ?? '(none)'}\n\nTranscript:\n${condensed}\n\nExtract the durable memories as a JSON array.`;
    const raw = await callModel(SYSTEM_PROMPT, userPrompt);
    return parseCandidates(raw);
}
//# sourceMappingURL=extract.js.map