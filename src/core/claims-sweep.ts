/**
 * Claim decomposition sweep — resumable, chunked pass over memories,
 * mirroring src/core/distill.ts's cursor/chunk/backend-failure-abort shape
 * exactly (buildEligibleQuery/countEligible/LLM_FAILURE_ABORT pattern),
 * applied to claims_extracted_at instead of distilled_at.
 *
 * Full-population decomposition is a many-hour job (measured throughput:
 * ~10-30s/call with real backend contention) — this is the core function a
 * driver script (scripts/claim-decompose-sweep.mjs) calls chunk-by-chunk,
 * the same relationship distill-sweep.mjs has to distillMemories().
 */

import Database from 'better-sqlite3';
import { callModel } from './llm.js';
import { extractClaimsForMemory } from '../capture/claim-extract.js';
import type { MemoryType } from './types.js';

// Same rationale as distill.ts: a dead backend must not burn through the
// whole candidate pool marking everything examined while producing nothing.
const LLM_FAILURE_ABORT = 5;

export interface ClaimsSweepOptions {
	project?: string;
	limit?: number;
	since?: string;
}

export interface ClaimsSweepResult {
	processed: number;
	accepted: number;
	rejected: number;
	claimsWritten: number;
	backendFailed: boolean;
	eligibleRemaining: number;
}

interface EligibleMemoryRow {
	id: string;
	body: string;
	memory_type: MemoryType;
	confidence: number;
}

export function buildEligibleMemoriesQuery(project: string | undefined, limit: number, since?: string): { sql: string; params: Record<string, unknown> } {
	const cursor = since ? `(claims_extracted_at IS NULL OR claims_extracted_at < :since)` : `claims_extracted_at IS NULL`;
	const sinceParam = since ? { since } : {};
	const projectClause = project ? `AND project = :project` : '';
	return {
		sql: `SELECT id, body, memory_type, confidence FROM memories
		      WHERE superseded_by IS NULL AND review_status = 'approved' ${projectClause} AND ${cursor}
		      ORDER BY confidence DESC, created_at ASC LIMIT :limit`,
		params: { limit, ...(project ? { project } : {}), ...sinceParam },
	};
}

export function countEligibleMemories(db: Database.Database, project?: string, since?: string): number {
	const cursor = since ? `(claims_extracted_at IS NULL OR claims_extracted_at < :since)` : `claims_extracted_at IS NULL`;
	const projectClause = project ? `AND project = :project` : '';
	const params: Record<string, unknown> = {};
	if (since) params.since = since;
	if (project) params.project = project;
	const sql = `SELECT COUNT(*) c FROM memories WHERE superseded_by IS NULL AND review_status = 'approved' ${projectClause} AND ${cursor}`;
	const stmt = db.prepare(sql);
	return ((Object.keys(params).length ? stmt.get(params) : stmt.get()) as { c: number }).c;
}

function normalizeLimit(limit: number | undefined): number {
	if (limit === undefined || limit === null || Number.isNaN(limit) || limit <= 0) return 200;
	return Math.max(1, Math.min(500, Math.floor(limit)));
}

export async function decomposeMemoriesToClaims(
	db: Database.Database,
	opts?: ClaimsSweepOptions,
	callFn: (system: string, user: string) => Promise<string> = callModel,
): Promise<ClaimsSweepResult> {
	const limit = normalizeLimit(opts?.limit);
	const { sql, params } = buildEligibleMemoriesQuery(opts?.project, limit, opts?.since);
	const all = db.prepare(sql).all(params) as EligibleMemoryRow[];

	const result: ClaimsSweepResult = {
		processed: all.length, accepted: 0, rejected: 0, claimsWritten: 0, backendFailed: false, eligibleRemaining: 0,
	};

	const markExtracted = db.prepare(`UPDATE memories SET claims_extracted_at = ? WHERE id = ?`);
	const unmarkExtracted = db.prepare(`UPDATE memories SET claims_extracted_at = NULL WHERE id = ?`);
	const runStamp = (db.prepare(`SELECT datetime('now') AS t`).get() as { t: string }).t;

	let consecutiveFailures = 0;

	for (const [index, m] of Array.from(all.entries())) {
		// Stamp before work — a crash mid-sweep must not cost progress already made.
		markExtracted.run(runStamp, m.id);

		const extraction = await extractClaimsForMemory(db, m, callFn);
		if (extraction.rejected) {
			result.rejected++;
			if (++consecutiveFailures >= LLM_FAILURE_ABORT) {
				for (const rest of all.slice(index + 1)) unmarkExtracted.run(rest.id);
				result.backendFailed = true;
				break;
			}
			continue;
		}
		consecutiveFailures = 0;
		result.accepted++;
		result.claimsWritten += extraction.claims.length;
	}

	result.eligibleRemaining = countEligibleMemories(db, opts?.project, opts?.since);
	return result;
}
