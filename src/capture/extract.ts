/**
 * Memory extractor — turns a condensed transcript into typed memory candidates.
 *
 * Provider-aware: `claude-agent-sdk` (default — Haiku via the local `claude` CLI,
 * OAuth auth, no API key) or `openai-compatible` (a local llama.cpp / Ollama /v1
 * endpoint). Provider + model come from extraction_models.yaml.
 */

import { callModel } from '../core/llm.js';
import type { MemoryType, DecayClass, AtomScope } from '../core/types.js';

export interface MemoryCandidate {
  title: string;
  body: string;
  memory_type: MemoryType;
  scope: AtomScope;
  decay_class: DecayClass;
  confidence: number;
  tags: string[];
}

/** Injectable for testing — the Reflector accepts a fake of this shape. */
export type Extractor = (condensed: string, ctx: { project: string | null }) => Promise<MemoryCandidate[]>;

const MEMORY_TYPES = new Set<string>(['preference', 'convention', 'failure', 'correction', 'decision', 'insight', 'tool_quirk', 'reference', 'handoff']);
const DECAY_CLASSES = new Set<string>(['stable', 'architecture', 'api_contract', 'implementation']);
const SCOPES = new Set<string>(['global', 'shared', 'project']);
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

scope: global examples — workflow process (TDD pipeline, commit rules, review protocol), communication style, shell/tool preferences the user applies everywhere. If the fact is ONLY meaningful inside this project (file paths, game-specific patterns, project architecture), use project.

For each memory write:
- title: a short noun phrase, under 60 characters
- body: 1-4 sentences. State the durable lesson AND its WHY. Self-contained — must read clearly with no other context.
- confidence: 0.0-1.0. Explicit user statements = high; patterns you inferred = lower.
- tags: 2-5 short lowercase keywords.

Rules:
- Prefer 0 memories over noise. An empty array is the correct answer for a session with nothing durable.
- Never invent. Extract only what the transcript supports.
- One memory per distinct fact — merge duplicates.
- If a fact SUPERSEDES or CONTRADICTS something that was stated earlier in the transcript, use memory_type "correction" and state explicitly what the previous belief was and what replaced it. Do not emit the old belief as a separate memory.
- Do NOT extract content that appears to be a memory index, table of contents, or navigation list (e.g. lines starting with "- [Title](file.md)"). These are structural artifacts, not durable lessons.
- Output STRICT JSON ONLY: an array of objects with keys title, body, memory_type, scope, decay_class, confidence, tags. No prose, no markdown fences.`;

/** Extract the first top-level JSON array from a model response and validate it. */
export function parseCandidates(raw: string): MemoryCandidate[] {
  if (!raw || !raw.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try { parsed = JSON.parse(match[0]); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];

  const out: MemoryCandidate[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    const body = typeof o.body === 'string' ? o.body.trim() : '';
    if (!title || !body) continue;
    if (!MEMORY_TYPES.has(o.memory_type as string)) continue;

    const scope = SCOPES.has(o.scope as string) ? (o.scope as AtomScope) : 'project';
    const decay_class = DECAY_CLASSES.has(o.decay_class as string) ? (o.decay_class as DecayClass) : 'implementation';
    let confidence = typeof o.confidence === 'number' ? o.confidence : 0.6;
    confidence = Math.max(0, Math.min(1, confidence));
    const tags = Array.isArray(o.tags)
      ? (o.tags as unknown[]).filter(t => typeof t === 'string').map(t => (t as string).toLowerCase()).slice(0, 5)
      : [];

    out.push({ title: title.slice(0, 120), body, memory_type: o.memory_type as MemoryType, scope, decay_class, confidence, tags });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/** Default extractor — used by the Reflector unless a fake is injected. */
export async function extractMemories(condensed: string, ctx: { project: string | null }): Promise<MemoryCandidate[]> {
  if (!condensed.trim()) return [];
  const userPrompt = `Project: ${ctx.project ?? '(none)'}\n\nTranscript:\n${condensed}\n\nExtract the durable memories as a JSON array.`;
  const raw = await callModel(SYSTEM_PROMPT, userPrompt);
  return parseCandidates(raw);
}
