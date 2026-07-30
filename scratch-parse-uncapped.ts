/**
 * Scratch, read-only -- NOT part of the project, never committed.
 * Copy of extract.ts's parseCandidates/refineCandidates with MAX_CANDIDATES raised to 40,
 * to check whether V3 (combined enumerate+phase cue) genuinely wants >20 candidates on a
 * 197K-char whole-session input, or whether 20 was already a natural stopping point.
 */
import type { MemoryType, DecayClass, AtomScope, PromotionTarget } from './src/core/types.js';
import type { MemoryCandidate } from './src/capture/extract.js';
import { callModel } from './src/core/llm.js';
import { COMPLETION_RE, ADR_REF_RE, RESTATEMENT_RE } from './src/capture/extract.js';

const MEMORY_TYPES = new Set<string>(['preference', 'convention', 'failure', 'correction', 'decision', 'insight', 'tool_quirk', 'reference']);
const PROMOTION_TARGETS = new Set<string>(['none', 'adr', 'ddr', 'best_practice', 'recipe', 'note']);
const DECAY_CLASSES = new Set<string>(['stable', 'architecture', 'api_contract', 'implementation']);
const SCOPES = new Set<string>(['global', 'shared', 'project']);
const MAX_CANDIDATES_UNCAPPED = 40;

function parseCandidatesUncapped(raw: string): MemoryCandidate[] {
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
    const tags = Array.isArray(o.tags) ? (o.tags as unknown[]).filter(t => typeof t === 'string').map(t => (t as string).toLowerCase()).slice(0, 5) : [];
    const promotion_target = PROMOTION_TARGETS.has(o.promotion_target as string) ? (o.promotion_target as PromotionTarget) : 'none';
    out.push({ title: title.slice(0, 120), body, memory_type: o.memory_type as MemoryType, scope, decay_class, confidence, tags, promotion_target });
    if (out.length >= MAX_CANDIDATES_UNCAPPED) break;
  }
  return out;
}

function refineCandidatesUncapped(cands: MemoryCandidate[]): MemoryCandidate[] {
  const out: MemoryCandidate[] = [];
  for (const c of cands) {
    if (COMPLETION_RE.test(c.title) || COMPLETION_RE.test(c.body)) continue;
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

export async function extractUncapped(condensed: string, ctx: { project: string | null }, systemPrompt: string): Promise<MemoryCandidate[]> {
  const userPrompt = `Project: ${ctx.project ?? '(none)'}\n\nTranscript:\n${condensed}\n\nExtract the durable memories as a JSON array.`;
  const raw = await callModel(systemPrompt, userPrompt);
  return refineCandidatesUncapped(parseCandidatesUncapped(raw));
}
