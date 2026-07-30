/**
 * Scratch, read-only prompt-variant module -- NOT part of the project, never committed.
 * Copies extract.ts's SYSTEM_PROMPT and adds two tuned variants aimed at vcc_compact's
 * longer, narrative, phase-structured input. Reuses the same callModel + parseCandidates/
 * refineCandidates pipeline so results are directly comparable to extractMemories() baselines.
 * No DB access anywhere -- pure LLM call + in-memory parse.
 */
import { callModel } from './src/core/llm.js';
import { parseCandidates, refineCandidates, type MemoryCandidate } from './src/capture/extract.js';

const BASE_RULES = `You extract durable, reusable MEMORIES from a Claude Code coding-assistant session transcript.

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

const ENUMERATE_CUE = `

IMPORTANT — this transcript is LONG and covers MULTIPLE distinct spans of work, not a single story. Do not just report the single most salient headline finding. Systematically enumerate EVERY distinct durable fact, decision, failure, correction, or quirk you find across the WHOLE transcript, in order. A long transcript with only 2-3 memories extracted is almost always under-extraction, not a genuinely quiet session — re-scan before finalizing if your list feels short relative to the input length.`;

const PHASE_CUE = `

IMPORTANT — this transcript is structured into phase sections marked "### Phase: <name>" or "### [Non-Flow span: ...]". Treat EACH such section as an independent unit of work: scan it on its own for at least one durable fact/decision/failure/quirk before moving to the next section. Do not let an earlier section's finding suppress attention to later sections — sessions commonly contain multiple unrelated durable facts, one per phase.`;

export const SYSTEM_PROMPT_V1_ENUMERATE = BASE_RULES + ENUMERATE_CUE;
export const SYSTEM_PROMPT_V2_PHASE = BASE_RULES + PHASE_CUE;
export const SYSTEM_PROMPT_V3_COMBINED = BASE_RULES + ENUMERATE_CUE + PHASE_CUE;

export async function extractMemoriesTuned(
  condensed: string,
  ctx: { project: string | null; decisions?: string[] },
  systemPrompt: string,
): Promise<MemoryCandidate[]> {
  if (!condensed.trim()) return [];
  const decisionsBlock = ctx.decisions && ctx.decisions.length
    ? `\n\nExisting canonical decisions (already recorded as ADR/DDR — do NOT restate these; emit a reference pointer if relevant):\n${ctx.decisions.map(d => `- ${d}`).join('\n')}`
    : '';
  const userPrompt = `Project: ${ctx.project ?? '(none)'}${decisionsBlock}\n\nTranscript:\n${condensed}\n\nExtract the durable memories as a JSON array.`;
  const raw = await callModel(systemPrompt, userPrompt);
  return refineCandidates(parseCandidates(raw));
}
