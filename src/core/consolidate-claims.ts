/**
 * Claim consolidation — dedupe-and-link (Phase 2, _documents/design-structured-memory.md).
 *
 * Mirrors consolidateMemories()'s shape but respects claim immutability:
 * consolidateMemories's "duplicates" band actually calls `supersede.run()`,
 * destructively hiding the loser. Claims may only ADD, LINK, or MARK
 * INVALID — so the equivalent here is markClaimInvalid() (sets
 * valid_until/expired_at, writes a `supersedes` edge), never a silent
 * content merge. `fact` is never rewritten by anything in this file.
 *
 * Order of operations per candidate pair, and why: the numeric-contradiction
 * guard (q-011) runs BEFORE similarity scoring and can VETO it entirely —
 * two claims naming the same subject with different values are routed to
 * `contradicts`, never to `duplicates`/`same_as`, regardless of how high
 * their combined similarity score is. No similarity score may override it.
 *
 * Middle-band (`flag`) adjudication: Neo4j Agent Memory's own pattern treats
 * this band as "pending human review," not an automated LLM confirmation —
 * that is what's implemented here (a `same_as` edge, no LLM call). An LLM
 * bounded-confirmation step (mirroring DDR-005's contradiction-detection
 * pre-filter + confirmation pattern) is a documented follow-up, not built in
 * this pass.
 */

import Database from 'better-sqlite3';
import { generateEmbedding } from './embeddings.js';
import { embedClaim, markClaimInvalid } from './claims.js';
import { detectNumericContradiction, writeContradictionLinks } from './claim-contradiction.js';
import {
	classifyDedupBand, fuzzyStringSimilarity, findDedupCandidates, combinedSimilarity, claimCosineSimilarity,
	identifiersDisjoint, type DedupQueryClaim,
} from './claim-dedup.js';
import type { MemoryType } from './types.js';

export interface ConsolidateClaimsOptions {
	project?: string; // scope to one project's claims; omit for all
}

export interface ConsolidateClaimsResult {
	embedded: number;
	processed: number;
	autoMerged: number;    // claims invalidated as duplicates (markClaimInvalid + supersedes edge)
	flagged: number;       // same_as pending-review edge pairs written
	contradictions: number; // contradicts edge pairs written
}

interface LiveClaimRow {
	id: string;
	memory_id: string;
	claim_type: MemoryType;
	fact: string;
	confidence: number;
}

function writeSameAsLink(db: Database.Database, claimIdA: string, claimIdB: string): void {
	const link = db.prepare(
		`INSERT OR IGNORE INTO memory_links (source_id, target_id, link_type, confidence) VALUES (?, ?, 'same_as', ?)`
	);
	link.run(claimIdA, claimIdB, 1.0);
	link.run(claimIdB, claimIdA, 1.0);
}

export async function consolidateClaims(
	db: Database.Database,
	opts?: ConsolidateClaimsOptions,
	embedFn: (text: string) => Promise<Float32Array | null> = generateEmbedding,
): Promise<ConsolidateClaimsResult> {
	const result: ConsolidateClaimsResult = { embedded: 0, processed: 0, autoMerged: 0, flagged: 0, contradictions: 0 };

	const sql = opts?.project
		? `SELECT c.id, c.memory_id, c.claim_type, c.fact, c.confidence
		   FROM claims c JOIN memories m ON m.id = c.memory_id
		   WHERE c.valid_until IS NULL AND m.project = @project
		   ORDER BY c.confidence DESC, c.created_at ASC`
		: `SELECT id, memory_id, claim_type, fact, confidence FROM claims
		   WHERE valid_until IS NULL ORDER BY confidence DESC, created_at ASC`;
	const claims = db.prepare(sql).all(opts?.project ? { project: opts.project } : {}) as LiveClaimRow[];
	result.processed = claims.length;

	// Embed any claim lacking a vector before scoring.
	for (const c of claims) {
		const rowid = (db.prepare(`SELECT rowid FROM claims WHERE id = ?`).get(c.id) as { rowid: number }).rowid;
		const hasVec = db.prepare(`SELECT 1 FROM claims_vec WHERE rowid = ?`).get(rowid);
		if (!hasVec) {
			if (await embedClaim(db, c.id, embedFn)) result.embedded++;
		}
	}

	const invalidatedThisRun = new Set<string>();

	for (const claim of claims) {
		if (invalidatedThisRun.has(claim.id)) continue;

		const queryClaim: DedupQueryClaim = { id: claim.id, memory_id: claim.memory_id, claim_type: claim.claim_type, fact: claim.fact };
		const candidates = findDedupCandidates(db, queryClaim);

		for (const candidate of candidates) {
			if (invalidatedThisRun.has(candidate.id) || invalidatedThisRun.has(claim.id)) continue;

			const contradiction = detectNumericContradiction(claim.fact, candidate.fact);
			if (contradiction) {
				writeContradictionLinks(db, claim.id, candidate.id);
				result.contradictions++;
				continue;
			}

			if (identifiersDisjoint(claim.fact, candidate.fact)) continue;

			const fuzzy = fuzzyStringSimilarity(claim.fact, candidate.fact);
			const embeddingSim = claimCosineSimilarity(db, claim.id, candidate.id);
			const combined = combinedSimilarity(embeddingSim, fuzzy);
			const band = classifyDedupBand(combined);

			if (band === 'auto_merge') {
				const candidateConfidence = (db.prepare(`SELECT confidence FROM claims WHERE id = ?`).get(candidate.id) as { confidence: number }).confidence;
				const [survivor, loser] = claim.confidence >= candidateConfidence
					? [claim.id, candidate.id]
					: [candidate.id, claim.id];
				markClaimInvalid(db, loser, survivor);
				invalidatedThisRun.add(loser);
				result.autoMerged++;
			} else if (band === 'flag') {
				writeSameAsLink(db, claim.id, candidate.id);
				result.flagged++;
			}
		}
	}

	return result;
}
