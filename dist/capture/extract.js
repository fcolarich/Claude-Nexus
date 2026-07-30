/**
 * Memory extractor — turns a condensed transcript into typed memory candidates.
 *
 * Provider-aware: `claude-agent-sdk` (default — Haiku via the local `claude` CLI,
 * OAuth auth, no API key) or `openai-compatible` (a local llama.cpp / Ollama /v1
 * endpoint). Provider + model come from extraction_models.yaml.
 */
import { callModel } from '../core/llm.js';
const MEMORY_TYPES = new Set(['preference', 'convention', 'failure', 'correction', 'decision', 'insight', 'tool_quirk', 'reference']);
const PROMOTION_TARGETS = new Set(['none', 'adr', 'ddr', 'best_practice', 'recipe', 'note']);
const DECAY_CLASSES = new Set(['stable', 'architecture', 'api_contract', 'implementation']);
const SCOPES = new Set(['global', 'shared', 'project']);
const MAX_CANDIDATES = 20;
/**
 * Completion / session-progress narration — never durable knowledge.
 * Deliberately narrow: only matches explicit completion announcements, NOT broad
 * domain terms ("knowledge extraction", "doc spine", bare "initialized") that
 * appear inside legitimate conventions and insights.
 */
export const COMPLETION_RE = /\b(scaffold(ed)?\s+complete|(doc\s+)?spine\s+(initialized|complete)|indexed\s+for\s+semantic\s+search|extraction\s+completed|setup\s+complete|initialization\s+complete)\b/i;
/** A cited Architecture/Design Decision Record id. */
export const ADR_REF_RE = /\b(ADR|DDR)-\d+/i;
/**
 * A decision body that is a *pure restatement* of an ADR/DDR — short and saying
 * the decision is recorded there. Only these become pointers; a decision that
 * merely cites an ADR while carrying its own rationale is left intact.
 */
export const RESTATEMENT_RE = /\b(codified|recorded|documented|captured)\s+in\s+(adr|ddr)-\d+/i;
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

promotion_target — should this memory graduate into a curated artifact? pick one:
- adr           — a structural/technical decision with rationale that is NOT yet recorded as an ADR (if already recorded, the existing rules emit a reference memory instead)
- ddr           — a design decision (UX, API shape, data model, naming, game mechanic) not yet recorded as a DDR
- best_practice — a reusable, citation-backable technique that applies across projects (typically Unity/engine domain)
- recipe        — a worked example solving a recurring problem, grounded in real project code
- note          — a project-specific gotcha, spike result, or open question worth a durable note
- none          — everything else (preferences, corrections, tool quirks, session state). DEFAULT — when unsure, use none.

Rules:
- promotion_target is INDEPENDENT of memory_type (a "decision" memory that is already ADR-recorded gets none; an "insight" may still be best_practice material).
- Be conservative: a promotion candidate creates human review work. Only flag entries a maintainer would plausibly formalize.
- Never flag session-progress narration, restatements of existing ADRs/DDRs, or facts derivable from the code.

decay_class — how fast the memory goes stale:
- stable         — preferences, conventions; rarely change
- architecture   — design decisions; change slowly
- api_contract   — interface/contract facts; medium pace
- implementation — current implementation details/state; change fast

scope:
- project — specific to this project (default)
- global  — a cross-project user preference or universal convention
- shared  — team-level knowledge

scope: global examples — workflow process (TDD pipeline, commit rules, review protocol), communication style, shell/tool preferences the user applies everywhere. If the fact is ONLY meaningful inside this project (file paths, game-specific patterns, project architecture), use project.

For each memory write:
- title: a short noun phrase, under 60 characters
- body: 1-3 terse sentences or fragments — telegraphic style. Drop articles, filler (just/really/basically/simply), pleasantries, and hedging; lead with the concrete fact and the keywords someone would search for. State the durable lesson AND its WHY. Self-contained — must read clearly with no other context. Dense, keyword-rich bodies retrieve better and cost fewer tokens than verbose prose.
- confidence: 0.0-1.0. Explicit user statements = high; patterns you inferred = lower.
- tags: 2-5 short lowercase keywords.

Rules:
- Prefer 0 memories over noise. An empty array is the correct answer for a session with nothing durable.
- Never invent. Extract only what the transcript supports.
- One memory per distinct fact — merge duplicates.
- If a fact SUPERSEDES or CONTRADICTS something that was stated earlier in the transcript, use memory_type "correction" and state explicitly what the previous belief was and what replaced it. Do not emit the old belief as a separate memory.
- Do NOT extract content that appears to be a memory index, table of contents, or navigation list (e.g. lines starting with "- [Title](file.md)"). These are structural artifacts, not durable lessons.
- Do NOT extract session-progress or completion narration. An announcement that the session DID something is not durable knowledge. Reject anything of the form "X initialized", "Y completed", "scaffold complete", "doc spine initialized", "knowledge extraction completed", "folder now indexed", "now available", "setup complete". These describe work performed, not a reusable fact.
- If a decision is ALREADY recorded as an ADR or DDR (see the "Existing canonical decisions" list in the user message, or if the transcript cites an ADR-NNN / DDR-NNN id), do NOT restate it. Emit a "reference" memory instead: title = the decision name, body = a one-line gist followed by "→ ADR-NNN". The ADR/DDR file is the source of truth; the memory only aids retrieval.
- Output STRICT JSON ONLY: an array of objects with keys title, body, memory_type, scope, decay_class, confidence, tags, promotion_target. No prose, no markdown fences.`;
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
        const promotion_target = PROMOTION_TARGETS.has(o.promotion_target) ? o.promotion_target : 'none';
        out.push({ title: title.slice(0, 120), body, memory_type: o.memory_type, scope, decay_class, confidence, tags, promotion_target });
        if (out.length >= MAX_CANDIDATES)
            break;
    }
    return out;
}
/**
 * Deterministic quality filter applied to extracted candidates.
 * - Drops completion / progress narration.
 * - Converts an ADR/DDR-citing `decision` into a thin `reference` pointer so the
 *   ADR stays canonical and the memory only aids retrieval (no content drift).
 *
 * Q4 NO-GO — per-candidate pre-LLM signal scoring: evaluated and declined.
 * The reflector observer gate (whole-extraction gate) already rejects low-signal
 * transcript windows before the LLM is called. This post-hoc COMPLETION_RE filter
 * then strips the residual narration that slips through. Together they cover the
 * practical case. Scoring each candidate individually before the LLM call would
 * add complexity for negligible gain — do not add it here.
 */
export function refineCandidates(cands) {
    const out = [];
    for (const c of cands) {
        if (COMPLETION_RE.test(c.title) || COMPLETION_RE.test(c.body))
            continue;
        if (c.memory_type === 'decision' && RESTATEMENT_RE.test(c.body) && c.body.length <= 200) {
            const ref = (c.body.match(ADR_REF_RE) ?? [])[0]?.toUpperCase() ?? '';
            const firstSentence = c.body.split(/(?<=[.!?])\s/)[0].trim();
            const body = ref && !firstSentence.includes(ref) ? `${firstSentence} → ${ref}` : firstSentence;
            out.push({ ...c, memory_type: 'reference', decay_class: 'architecture', body, promotion_target: 'none' });
            continue;
        }
        out.push(c);
    }
    return out;
}
/** Default extractor — used by the Reflector unless a fake is injected. */
export async function extractMemories(condensed, ctx) {
    if (!condensed.trim())
        return [];
    const decisionsBlock = ctx.decisions && ctx.decisions.length
        ? `\n\nExisting canonical decisions (already recorded as ADR/DDR — do NOT restate these; emit a reference pointer if relevant):\n${ctx.decisions.map(d => `- ${d}`).join('\n')}`
        : '';
    const userPrompt = `Project: ${ctx.project ?? '(none)'}${decisionsBlock}\n\nTranscript:\n${condensed}\n\nExtract the durable memories as a JSON array.`;
    const raw = await callModel(SYSTEM_PROMPT, userPrompt);
    return refineCandidates(parseCandidates(raw));
}
//# sourceMappingURL=extract.js.map