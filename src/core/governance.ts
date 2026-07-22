/**
 * Governance — automated confidence adjustment based on observed help-rate stats.
 *
 * governByHelpRate is pure SQL, phase 4 of consolidateMemories(). Contradiction
 * detection (phase 5) is gated behind DDR-005.
 */

import Database from 'better-sqlite3';
import { callModel } from './llm.js';

export const MIN_EVALUATIONS = 5;
export const LOW_THRESHOLD = 0.3;
export const HIGH_THRESHOLD = 0.8;
export const CONFIDENCE_FLOOR = 0.1;
export const DEMOTE_FACTOR = 0.85;
export const REINFORCE_BUMP = 0.05;
export const DIVERGENCE_CONF = 0.3;
export const MAX_PAIRS_PER_RUN = 20;

export interface GovernResult {
	demoted: number;
	reinforced: number;
}

export interface ContradictionResult {
	contradictionsFlagged: number;
	contradictionPairsChecked: number;
}

export type HaikuFn = (systemPrompt: string, userPrompt: string) => Promise<string>;

export function governByHelpRate(db: Database.Database): GovernResult {
	const rows = db.prepare(`
		SELECT id, confidence, use_count, help_count FROM memories
		WHERE review_status = 'approved' AND superseded_by IS NULL AND use_count >= ?
	`).all(MIN_EVALUATIONS) as { id: string; confidence: number; use_count: number; help_count: number }[];

	const demoteStmt = db.prepare(`
		UPDATE memories SET confidence = ?, use_count = 0, help_count = 0, updated_at = datetime('now')
		WHERE id = ?
	`);
	const reinforceStmt = db.prepare(`
		UPDATE memories SET confidence = ?, use_count = 0, help_count = 0,
			updated_at = datetime('now'), last_verified_at = datetime('now')
		WHERE id = ?
	`);
	const deadZoneStmt = db.prepare(`
		UPDATE memories SET use_count = 0, help_count = 0, updated_at = datetime('now')
		WHERE id = ?
	`);

	let demoted = 0;
	let reinforced = 0;

	const run = db.transaction(() => {
		for (const row of rows) {
			const helpRate = row.help_count / row.use_count;
			if (helpRate < LOW_THRESHOLD) {
				const confidence = Math.max(CONFIDENCE_FLOOR, row.confidence * DEMOTE_FACTOR);
				demoteStmt.run(confidence, row.id);
				demoted++;
			} else if (helpRate > HIGH_THRESHOLD) {
				const confidence = Math.min(1.0, row.confidence + REINFORCE_BUMP);
				reinforceStmt.run(confidence, row.id);
				reinforced++;
			} else {
				deadZoneStmt.run(row.id);
			}
		}
	});
	run();

	return { demoted, reinforced };
}

interface ContradictionCandidate {
	source_id: string;
	target_id: string;
	m1_title: string;
	m1_body: string;
	m1_confidence: number;
	m1_decay_class: string;
	m2_title: string;
	m2_body: string;
	m2_confidence: number;
	m2_decay_class: string;
}

// Shared existence check: does a 'stale' diagnostic already exist whose
// details.reason='contradiction' and details.memory_ids sorted-matches pairIds?
// Used by both the confirmed-write path and self-heal re-derivation.
function contradictionDiagnosticExists(db: Database.Database, pairIds: string[]): boolean {
	const sortedPair = [...pairIds].sort().join('|');
	const existing = db.prepare(`
		SELECT details FROM diagnostics
		WHERE type = 'stale' AND details LIKE '%"reason":"contradiction"%'
	`).all() as { details: string | null }[];
	return existing.some((row) => {
		if (!row.details) return false;
		try {
			const d = JSON.parse(row.details) as { memory_ids?: string[] };
			return Array.isArray(d.memory_ids) && [...d.memory_ids].sort().join('|') === sortedPair;
		} catch {
			return false;
		}
	});
}

// Self-heal: re-derives 'stale' contradiction diagnostics for any confirmed
// 'contradicts' pair whose diagnostic was lost (e.g. decay.ts wiping all
// 'stale' diagnostics). Runs every call; idempotent via the existence check.
function selfHealContradictionDiagnostics(db: Database.Database): void {
	const pairs = db.prepare(`
		SELECT DISTINCT l.source_id AS source_id, l.target_id AS target_id,
			m1.title AS m1_title, m2.title AS m2_title
		FROM memory_links l
		JOIN memories m1 ON l.source_id = m1.id
		JOIN memories m2 ON l.target_id = m2.id
		WHERE l.link_type = 'contradicts' AND l.source_id < l.target_id
	`).all() as { source_id: string; target_id: string; m1_title: string; m2_title: string }[];

	const heal = db.transaction(() => {
		for (const p of pairs) {
			const pairIds = [p.source_id, p.target_id];
			if (contradictionDiagnosticExists(db, pairIds)) continue;

			db.prepare(`
				INSERT INTO diagnostics (type, atom_id, message, details)
				VALUES ('stale', NULL, ?, ?)
			`).run(
				`Contradiction candidate: ${p.m1_title} vs ${p.m2_title}`,
				JSON.stringify({
					reason: 'contradiction',
					memory_ids: pairIds,
					haiku_reason: '(re-derived, original reason lost)',
				}),
			);
		}
	});
	heal();
}

export async function detectContradictions(
	db: Database.Database,
	haikuFn: HaikuFn = callModel
): Promise<ContradictionResult> {
	const candidates = db.prepare(`
		SELECT
			l.source_id AS source_id, l.target_id AS target_id,
			m1.title AS m1_title, m1.body AS m1_body, m1.confidence AS m1_confidence, m1.decay_class AS m1_decay_class,
			m2.title AS m2_title, m2.body AS m2_body, m2.confidence AS m2_confidence, m2.decay_class AS m2_decay_class
		FROM memory_links l
		JOIN memories m1 ON l.source_id = m1.id
		JOIN memories m2 ON l.target_id = m2.id
		WHERE l.link_type = 'related'
			AND m1.review_status = 'approved' AND m2.review_status = 'approved'
			AND m1.superseded_by IS NULL AND m2.superseded_by IS NULL
			AND m1.scope = m2.scope
			AND (m1.project IS m2.project)
			AND (ABS(m1.confidence - m2.confidence) > ? OR m1.decay_class != m2.decay_class)
			AND NOT EXISTS (
				SELECT 1 FROM memory_links c
				WHERE c.link_type = 'contradicts'
					AND (
						(c.source_id = l.source_id AND c.target_id = l.target_id)
						OR (c.source_id = l.target_id AND c.target_id = l.source_id)
					)
			)
		ORDER BY l.created_at ASC
		LIMIT ?
	`).all(DIVERGENCE_CONF, MAX_PAIRS_PER_RUN) as ContradictionCandidate[];

	let contradictionsFlagged = 0;
	let contradictionPairsChecked = 0;

	for (const c of candidates) {
		contradictionPairsChecked++;
		try {
			const systemPrompt = 'You are checking whether two memory entries assert genuinely incompatible facts. ' +
				'Respond with strict JSON only: {"conflict": boolean, "reason": string}.';
			const userPrompt = [
				`Memory 1 (id: ${c.source_id}):`,
				`Title: ${c.m1_title}`,
				`Body: ${c.m1_body}`,
				`Confidence: ${c.m1_confidence}, decay_class: ${c.m1_decay_class}`,
				'',
				`Memory 2 (id: ${c.target_id}):`,
				`Title: ${c.m2_title}`,
				`Body: ${c.m2_body}`,
				`Confidence: ${c.m2_confidence}, decay_class: ${c.m2_decay_class}`,
			].join('\n');

			const response = await haikuFn(systemPrompt, userPrompt);

			let parsed: unknown;
			try {
				parsed = JSON.parse(response);
			} catch {
				continue;
			}
			if (
				typeof parsed !== 'object' || parsed === null ||
				typeof (parsed as { conflict?: unknown }).conflict !== 'boolean'
			) {
				continue;
			}

			const conflict = (parsed as { conflict: boolean }).conflict;
			if (conflict) {
				const haikuReason = typeof (parsed as { reason?: unknown }).reason === 'string'
					? (parsed as { reason: string }).reason
					: '';

				// Wrapped in a transaction: both directional links and the diagnostic
				// commit atomically, so a mid-write crash can never leave one
				// direction persisted without the other (which the shortlist's
				// bidirectional NOT EXISTS would then treat as already-flagged
				// forever, permanently losing the missing direction).
				const writeContradiction = db.transaction(() => {
					db.prepare(`
						INSERT OR IGNORE INTO memory_links (source_id, target_id, link_type, confidence)
						VALUES (?, ?, 'contradicts', 1.0)
					`).run(c.source_id, c.target_id);
					db.prepare(`
						INSERT OR IGNORE INTO memory_links (source_id, target_id, link_type, confidence)
						VALUES (?, ?, 'contradicts', 1.0)
					`).run(c.target_id, c.source_id);

					const alreadyFlagged = contradictionDiagnosticExists(db, [c.source_id, c.target_id]);

					if (!alreadyFlagged) {
						db.prepare(`
							INSERT INTO diagnostics (type, atom_id, message, details)
							VALUES ('stale', NULL, ?, ?)
						`).run(
							`Contradiction candidate: ${c.m1_title} vs ${c.m2_title}`,
							JSON.stringify({ reason: 'contradiction', memory_ids: [c.source_id, c.target_id], haiku_reason: haikuReason }),
						);
					}
				});
				writeContradiction();

				contradictionsFlagged++;
			}
		} catch {
			continue;
		}
	}

	selfHealContradictionDiagnostics(db);

	return { contradictionsFlagged, contradictionPairsChecked };
}
