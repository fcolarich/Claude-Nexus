/**
 * Claim-level confirmation gate for memory-level dedup (Phase 2 follow-up,
 * _documents/design-structured-memory.md).
 *
 * consolidateMemories()'s duplicate merge is a single raw cosine-similarity
 * threshold with no confirmation step — no fuzzy blend, no identifier veto,
 * nothing catching the same "boilerplate dominates similarity" failure mode
 * measured on claims (see claim-dedup.ts's identifiersDisjoint docstring).
 * A whole memory is a bigger unit to get wrong than one atomic claim, so an
 * ungated merge there is riskier, not safer.
 *
 * This is NOT a full corpus-wide claim decomposition — decomposition only
 * happens for a memory once it's already a dedup CANDIDATE (cheap embedding
 * pre-filter cleared threshold). Claims persist afterwards regardless of the
 * verdict (claims_extracted_at set either way), so later candidacy against a
 * different memory reuses them for free — cost amortizes across repeated
 * consolidation runs instead of paying upfront for the whole corpus.
 */
import Database from 'better-sqlite3';
import type { MemoryType } from './types.js';
export type MemoryDuplicateVerdict = 'confirmed' | 'contradicts' | 'insufficient';
interface ConfirmMemoryInput {
    id: string;
    body: string;
    memory_type: MemoryType;
    confidence: number;
}
/**
 * Confirm or refute a cheap-embedding-flagged memory duplicate candidate at
 * claim granularity. Lazily decomposes both memories (persisting claims
 * regardless of outcome), then:
 *   1. Any numeric contradiction between a claim in A and a claim in B ->
 *      'contradicts' immediately, no similarity scoring (mirrors
 *      consolidateClaims's own ordering — no score overrides a contradiction).
 *   2. Otherwise, for each of A's claims, look for a same_as/auto_merge-band
 *      match among B's claims that also passes the identifier-conflict veto.
 *      Coverage >= CONFIRM_COVERAGE -> 'confirmed'; else 'insufficient'.
 *   3. Either memory decomposing to zero live claims -> 'insufficient'
 *      (nothing to confirm with; caller should not treat this as a green light).
 */
export declare function confirmMemoryDuplicate(db: Database.Database, memoryA: ConfirmMemoryInput, memoryB: ConfirmMemoryInput, callFn: (system: string, user: string) => Promise<string>, embedFn?: (text: string) => Promise<Float32Array | null>): Promise<MemoryDuplicateVerdict>;
export {};
//# sourceMappingURL=memory-dedup-confirm.d.ts.map