/**
 * Throwaway A/B: memory-level retrieval (recall.ts, production) vs claim-level
 * retrieval (experimental, not wired into recall.ts) on the live nexus.db.
 *
 * Read-only against nexus.db. Not wired into anything. Delete after use.
 *
 * Usage: node scripts/claim-retrieval-eval.mjs
 */

import { openDatabase, initializeSchema } from '../dist/core/database.js';
import { recallByQuery } from '../dist/core/recall.js';
import { generateEmbedding } from '../dist/core/embeddings.js';

// Realistic queries drawn from this project's actual worked topics (no literal
// nexus_search calls are logged in this project's transcripts — recall here has
// been via the automatic prompt-submit hook, not explicit tool queries).
const QUERIES = [
	'why do we union identifiers instead of letting the model regenerate them',
	'claim dedup threshold auto merge vs flag',
	'resumable sweep cursor pattern for distill',
	'why are claim embeddings scoped to dedup only',
	'JSON escape repair for regex-shaped facts',
	'role confusion in local model prompts',
	'trade-off clause fragmentation in claim extraction',
	'memory_links CHECK constraint same_as supersedes',
	'snapshot and rollback before a live DB sweep',
	'numeric contradiction detection between claims',
];

const TOP_K = 5;
const PROJECT = 'C--Fran-claude-nexus'; // canonical git-root slug (ADR-013), not the per-worktree cwd slug

async function claimLevelRetrieve(db, query, limit, project) {
	const queryVec = await generateEmbedding(query);
	if (!queryVec) return [];
	const norm = Array.from(queryVec);
	let rows;
	try {
		rows = db.prepare(`
			SELECT rowid, distance FROM claims_vec
			WHERE embedding MATCH json(@v)
			ORDER BY distance
			LIMIT @k
		`).all({ v: JSON.stringify(norm), k: Math.max(limit * 6, 30) });
	} catch {
		return [];
	}

	const seenMemory = new Set();
	const out = [];
	for (const r of rows) {
		const claim = db.prepare(`
			SELECT c.id, c.memory_id, c.fact, m.title
			FROM claims c JOIN memories m ON m.id = c.memory_id
			WHERE c.rowid = @rowid AND c.valid_until IS NULL
			  AND m.review_status = 'approved' AND m.superseded_by IS NULL
			  AND (m.scope IN ('global','shared') OR (m.scope='project' AND m.project = @project))
		`).get({ rowid: r.rowid, project });
		if (!claim) continue;
		if (seenMemory.has(claim.memory_id)) continue; // roll up to parent memory, dedup
		seenMemory.add(claim.memory_id);
		const sim = Math.max(0, Math.min(1, 1 - (r.distance * r.distance) / 2));
		out.push({ memory_id: claim.memory_id, title: claim.title, matchedFact: claim.fact, sim });
		if (out.length >= limit) break;
	}
	return out;
}

async function main() {
	const db = openDatabase();
	initializeSchema(db);

	const claimCount = db.prepare('SELECT COUNT(*) c FROM claims WHERE valid_until IS NULL').get().c;
	console.log(`live claims available: ${claimCount}\n`);

	for (const query of QUERIES) {
		console.log(`\n=== "${query}" ===`);

		const memResult = await recallByQuery(db, { query, limit: TOP_K, project: PROJECT });
		console.log(`-- memory-level (top ${TOP_K}) --`);
		for (const item of memResult.items) {
			console.log(`  [${item.score?.toFixed(3) ?? '?'}] ${item.memory.title}`);
		}
		if (memResult.items.length === 0) console.log('  (none)');

		const claimResult = await claimLevelRetrieve(db, query, TOP_K, PROJECT);
		console.log(`-- claim-level, rolled up to parent memory (top ${TOP_K}) --`);
		for (const item of claimResult) {
			console.log(`  [${item.sim.toFixed(3)}] ${item.title}  <- "${item.matchedFact.slice(0, 90)}"`);
		}
		if (claimResult.length === 0) console.log('  (none)');

		const memIds = new Set(memResult.items.map(i => i.memory.id));
		const claimIds = new Set(claimResult.map(i => i.memory_id));
		const overlap = [...memIds].filter(id => claimIds.has(id)).length;
		console.log(`overlap: ${overlap}/${TOP_K}`);
	}

	db.close();
}

main().catch(err => { console.error(err); process.exit(1); });
