/**
 * Claim data layer — CRUD for the `claims` table (Phase 2,
 * _documents/design-structured-memory.md, design worktree).
 *
 * Claims are immutable once written. Consolidation may only ADD, LINK, or
 * MARK INVALID — nothing here ever UPDATEs `fact`. Identifiers are extracted
 * deterministically (src/core/identifiers.ts) unless the caller already
 * computed a set (mirrors src/core/memories.ts's insertMemory pattern).
 */
import Database from 'better-sqlite3';
import type { Claim, MemoryType } from './types.js';
export interface ClaimInput {
    memory_id: string;
    source_memory_id: string;
    fact: string;
    claim_type: MemoryType;
    confidence: number;
    identifiers?: string[];
}
/** Content-addressed id — identical (claim_type, fact) collapses to one row. */
export declare function computeClaimId(claim_type: string, fact: string): string;
/** Insert a claim. Returns inserted=false if the content-addressed id already exists (no-op). */
export declare function insertClaim(db: Database.Database, input: ClaimInput): {
    id: string;
    inserted: boolean;
};
export declare function getClaim(db: Database.Database, id: string): Claim | undefined;
/** Claims belonging to a memory. Excludes invalidated claims (valid_until IS NOT NULL) unless requested. */
export declare function listClaimsForMemory(db: Database.Database, memory_id: string, opts?: {
    includeInvalid?: boolean;
}): Claim[];
/**
 * Mark a claim invalid. Never touches `fact` — only stamps valid_until/expired_at.
 * When `supersededByClaimId` is given, writes a directional `supersedes` edge
 * (new -> old) in memory_links, per DDR-20260808153555-7a: this is how
 * Graphiti-style invalidation is achieved WITHOUT adopting Graphiti's
 * fact-string rewrite (q-009/q-010) — "used to be true" phrasing belongs to
 * the superseding edge/claim, never to the invalidated claim's own text.
 * Idempotent: returns false (no-op) if the claim doesn't exist or is already invalid.
 */
export declare function markClaimInvalid(db: Database.Database, id: string, supersededByClaimId?: string): boolean;
//# sourceMappingURL=claims.d.ts.map