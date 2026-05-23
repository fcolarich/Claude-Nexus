/**
 * Memory extractor — turns a condensed transcript into typed memory candidates.
 *
 * Provider-aware: `claude-agent-sdk` (default — Haiku via the local `claude` CLI,
 * OAuth auth, no API key) or `openai-compatible` (a local llama.cpp / Ollama /v1
 * endpoint). Provider + model come from extraction_models.yaml.
 */
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
export type Extractor = (condensed: string, ctx: {
    project: string | null;
}) => Promise<MemoryCandidate[]>;
/** Extract the first top-level JSON array from a model response and validate it. */
export declare function parseCandidates(raw: string): MemoryCandidate[];
/** Default extractor — used by the Reflector unless a fake is injected. */
export declare function extractMemories(condensed: string, ctx: {
    project: string | null;
}): Promise<MemoryCandidate[]>;
//# sourceMappingURL=extract.d.ts.map