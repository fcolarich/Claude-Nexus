/**
 * Claim data layer — CRUD for the `claims` table (Phase 2,
 * _documents/design-structured-memory.md, design worktree).
 *
 * Claims are immutable once written. Consolidation may only ADD, LINK, or
 * MARK INVALID — nothing here ever UPDATEs `fact`. Identifiers are extracted
 * deterministically (src/core/identifiers.ts) unless the caller already
 * computed a set (mirrors src/core/memories.ts's insertMemory pattern).
 */
import { createHash } from 'crypto';
import { extractIdentifiers } from './identifiers.js';
/** Content-addressed id — identical (claim_type, fact) collapses to one row. */
export function computeClaimId(claim_type, fact) {
    return createHash('sha256').update(`${claim_type}\n${fact.trim()}`).digest('hex').slice(0, 16);
}
function rowToClaim(row) {
    return {
        ...row,
        identifiers: JSON.parse(row.identifiers || '[]'),
    };
}
/** Insert a claim. Returns inserted=false if the content-addressed id already exists (no-op). */
export function insertClaim(db, input) {
    const id = computeClaimId(input.claim_type, input.fact);
    const identifiers = input.identifiers ?? extractIdentifiers(input.fact);
    const res = db.prepare(`
		INSERT OR IGNORE INTO claims
			(id, memory_id, source_memory_id, fact, claim_type, identifiers, confidence)
		VALUES
			(@id, @memory_id, @source_memory_id, @fact, @claim_type, @identifiers, @confidence)
	`).run({
        id,
        memory_id: input.memory_id,
        source_memory_id: input.source_memory_id,
        fact: input.fact,
        claim_type: input.claim_type,
        identifiers: JSON.stringify(identifiers),
        confidence: input.confidence,
    });
    return { id, inserted: res.changes > 0 };
}
export function getClaim(db, id) {
    const row = db.prepare(`SELECT * FROM claims WHERE id = ?`).get(id);
    return row ? rowToClaim(row) : undefined;
}
/** Claims belonging to a memory. Excludes invalidated claims (valid_until IS NOT NULL) unless requested. */
export function listClaimsForMemory(db, memory_id, opts) {
    const sql = opts?.includeInvalid
        ? `SELECT * FROM claims WHERE memory_id = ? ORDER BY created_at ASC`
        : `SELECT * FROM claims WHERE memory_id = ? AND valid_until IS NULL ORDER BY created_at ASC`;
    return db.prepare(sql).all(memory_id).map(rowToClaim);
}
/**
 * Mark a claim invalid. Never touches `fact` — only stamps valid_until/expired_at.
 * When `supersededByClaimId` is given, writes a directional `supersedes` edge
 * (new -> old) in memory_links, per DDR-20260808153555-7a: this is how
 * Graphiti-style invalidation is achieved WITHOUT adopting Graphiti's
 * fact-string rewrite (q-009/q-010) — "used to be true" phrasing belongs to
 * the superseding edge/claim, never to the invalidated claim's own text.
 * Idempotent: returns false (no-op) if the claim doesn't exist or is already invalid.
 */
export function markClaimInvalid(db, id, supersededByClaimId) {
    const res = db.prepare(`UPDATE claims SET valid_until = datetime('now'), expired_at = datetime('now') WHERE id = ? AND valid_until IS NULL`).run(id);
    if (res.changes === 0)
        return false;
    if (supersededByClaimId) {
        db.prepare(`INSERT OR IGNORE INTO memory_links (source_id, target_id, link_type, confidence) VALUES (?, ?, 'supersedes', 1.0)`).run(supersededByClaimId, id);
    }
    return true;
}
//# sourceMappingURL=claims.js.map