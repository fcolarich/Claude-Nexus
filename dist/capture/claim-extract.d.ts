/**
 * Claim extraction — decomposes one memory into atomic claims (Phase 2,
 * _documents/design-structured-memory.md, design worktree).
 *
 * NOT wired into the capture path (auto-distill-on-write is out of scope per
 * the design doc's stated scope exclusion). Run explicitly, on a measured
 * subset first — full-population decomposition is deferred pending that
 * validation (design doc, "Migration and backfill strategy").
 *
 * Extract-then-verify loop per DDR-20260808153651-39: deterministic checker
 * (code, not the model judging itself), missing identifiers enumerated as
 * data on retry (Chain-of-Density's working mechanism — arXiv:2309.04269),
 * max 2 retries, REJECT on final failure — never a partial write, sources
 * (the memory) stay untouched.
 *
 * Claim body authoring is generative (model call injected via `callFn`, same
 * pattern as distill.ts's mergePrompt — use whatever model distillation uses,
 * not necessarily Haiku; the design doc's "Haiku extraction" label names the
 * mechanism class, not a hard model requirement). claim_type is DERIVED from
 * the parent memory_type, never asked of the model; identifiers are extracted
 * deterministically per claim (src/core/identifiers.ts), never model-generated.
 * No response_format/constrained decoding (q-007 — corrupted 91 memories,
 * rejected).
 */
import type { MemoryType } from '../core/types.js';
import type Database from 'better-sqlite3';
export declare const claimExtractPrompt: (missing?: string[]) => string;
/**
 * Identifiers present in the source text but absent from every generated
 * claim's own fact text. The deterministic checker driving the retry loop —
 * never the model judging itself.
 */
export declare function missingIdentifiers(sourceText: string, claimFacts: string[]): string[];
export interface ClaimExtractSourceMemory {
    id: string;
    body: string;
    memory_type: MemoryType;
    confidence: number;
}
export interface ClaimExtractResult {
    claims: {
        id: string;
        claim_type: MemoryType;
        fact: string;
    }[];
    rejected: boolean;
    reason?: 'unparseable' | 'empty' | 'missing-identifiers';
}
/**
 * Extract claims for one memory, verify identifier coverage, retry with the
 * missing set named, and on final failure reject WITHOUT writing anything —
 * the memory (source) is never touched, per the design's never-supersede-
 * on-failed-verify constraint (mirrors distill.ts's coverage-gate rejection).
 */
export declare function extractClaimsForMemory(db: Database.Database, memory: ClaimExtractSourceMemory, callFn: (system: string, user: string) => Promise<string>): Promise<ClaimExtractResult>;
//# sourceMappingURL=claim-extract.d.ts.map