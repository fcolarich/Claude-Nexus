#!/usr/bin/env node
/**
 * Review distill merges: pulls the most recent non-superseded memories for a
 * project and shows each merged memory next to the originals it folded in
 * (via memories.superseded_by). Read-only — safe to run anytime after
 * nexus_distill / nexus_consolidate.
 *
 * Usage:
 *   node scripts/review-distill.mjs <project-slug> [limit]
 *   npm run review-distill -- <project-slug> [limit]
 *
 * project-slug: full project slug as stored in memories.project
 *               (e.g. "C--Fran-claude-nexus"). Omit for the global bucket.
 * limit: how many recent memories to inspect (default 8).
 */
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

const [, , project, limitArg] = process.argv;
const limit = Number(limitArg) || 8;

const dbPath = join(homedir(), '.claude', 'memories', 'nexus.db');
const db = new Database(dbPath, { readonly: true });

const rows = project
	? db.prepare(`
		SELECT id, title, body, memory_type, confidence, created_at
		FROM memories
		WHERE project = ? AND superseded_by IS NULL
		ORDER BY created_at DESC
		LIMIT ?
	`).all(project, limit)
	: db.prepare(`
		SELECT id, title, body, memory_type, confidence, created_at
		FROM memories
		WHERE project IS NULL AND superseded_by IS NULL
		ORDER BY created_at DESC
		LIMIT ?
	`).all(limit);

for (const m of rows) {
	const originals = db.prepare(`SELECT id, title, body FROM memories WHERE superseded_by = ?`).all(m.id);
	console.log('='.repeat(80));
	console.log(`[${m.memory_type}] ${m.title}  (conf ${m.confidence}, ${m.created_at})`);
	console.log(m.body);
	if (originals.length > 0) {
		console.log(`-- folded from ${originals.length} original(s) --`);
		for (const o of originals) {
			console.log(`  · ${o.title}: ${o.body.slice(0, 150)}${o.body.length > 150 ? '…' : ''}`);
		}
	} else {
		console.log('-- not a merge output (no superseded originals) --');
	}
}
db.close();
