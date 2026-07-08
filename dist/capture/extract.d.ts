/**
 * Memory extractor — turns a condensed transcript into typed memory candidates.
 *
 * Provider-aware: `claude-agent-sdk` (default — Haiku via the local `claude` CLI,
 * OAuth auth, no API key) or `openai-compatible` (a local llama.cpp / Ollama /v1
 * endpoint). Provider + model come from extraction_models.yaml.
 */
import type { MemoryType, DecayClass, AtomScope, PromotionTarget } from '../core/types.js';
export interface MemoryCandidate {
    title: string;
    body: string;
    memory_type: MemoryType;
    scope: AtomScope;
    decay_class: DecayClass;
    confidence: number;
    tags: string[];
    promotion_target: PromotionTarget;
}
/** Injectable for testing — the Reflector accepts a fake of this shape. */
export type Extractor = (condensed: string, ctx: {
    project: string | null;
    decisions?: string[];
}) => Promise<MemoryCandidate[]>;
/**
 * Completion / session-progress narration — never durable knowledge.
 * Deliberately narrow: only matches explicit completion announcements, NOT broad
 * domain terms ("knowledge extraction", "doc spine", bare "initialized") that
 * appear inside legitimate conventions and insights.
 */
export declare const COMPLETION_RE: RegExp;
/** A cited Architecture/Design Decision Record id. */
export declare const ADR_REF_RE: RegExp;
/**
 * A decision body that is a *pure restatement* of an ADR/DDR — short and saying
 * the decision is recorded there. Only these become pointers; a decision that
 * merely cites an ADR while carrying its own rationale is left intact.
 */
export declare const RESTATEMENT_RE: RegExp;
/** Extract the first top-level JSON array from a model response and validate it. */
export declare function parseCandidates(raw: string): MemoryCandidate[];
/**
 * Deterministic quality filter applied to extracted candidates.
 * - Drops completion / progress narration.
 * - Converts an ADR/DDR-citing `decision` into a thin `reference` pointer so the
 *   ADR stays canonical and the memory only aids retrieval (no content drift).
 */
export declare function refineCandidates(cands: MemoryCandidate[]): MemoryCandidate[];
/** Default extractor — used by the Reflector unless a fake is injected. */
export declare function extractMemories(condensed: string, ctx: {
    project: string | null;
    decisions?: string[];
}): Promise<MemoryCandidate[]>;
//# sourceMappingURL=extract.d.ts.map