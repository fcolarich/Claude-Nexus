/**
 * Validate claim extraction on a SMALL measured subset before any full-
 * population run — per _documents/design-structured-memory.md's migration
 * strategy: "Full claim decomposition is deferred... and must be validated
 * on a measured subset before being applied to the full population."
 *
 * Read-only against the live corpus (writes to a throwaway :memory: DB, not
 * nexus.db) — safe to run repeatedly. Reports claims-per-memory, rejection
 * rate, and identifier coverage so the Phase 2 pass bar can be assessed
 * before committing to a full sweep.
 *
 * Usage: node scripts/claim-extract-sample.mjs [--sample N] [--merge-model MODEL]
 */

import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, initializeSchema } from '../dist/core/database.js';
import { extractClaimsForMemory } from '../dist/capture/claim-extract.js';
import { extractIdentifiers } from '../dist/core/identifiers.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : args[i + 1];
};
const sample = Number(flag('--sample', 15));
const mergeModel = flag('--merge-model', 'gemma3:12b');

const liveDb = new Database(join(homedir(), '.claude', 'memories', 'nexus.db'), { readonly: true });
const rows = liveDb.prepare(`
	SELECT id, title, body, memory_type, confidence FROM memories
	WHERE superseded_by IS NULL AND review_status = 'approved'
	ORDER BY RANDOM() LIMIT ?
`).all(sample);
liveDb.close();

const workDb = openDatabase(':memory:');
initializeSchema(workDb);
// Mirror each sampled memory into the throwaway DB so insertClaim's memory_id FK-like
// reference resolves — claims table has no real FK, but keeps the shape consistent.
const insertMirror = workDb.prepare(`
	INSERT INTO memories (id, title, body, memory_type, scope, confidence, decay_class, review_status, tags, content_hash)
	VALUES (@id, @title, @body, @memory_type, 'project', @confidence, 'implementation', 'approved', '[]', @id)
`);
for (const r of rows) insertMirror.run(r);

const ollamaCall = async (system, user) => {
	const res = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: mergeModel,
			messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
			temperature: 0.2,
			stream: false,
			max_tokens: 1500,
		}),
		signal: AbortSignal.timeout(60_000),
	});
	if (!res.ok) return '';
	const data = await res.json();
	return data?.choices?.[0]?.message?.content ?? '';
};

let totalClaims = 0;
let rejected = 0;
let totalSourceIdentifiers = 0;
let totalCoveredIdentifiers = 0;

for (const m of rows) {
	const result = await extractClaimsForMemory(workDb, m, ollamaCall);
	if (result.rejected) {
		rejected++;
		console.log(`REJECT [${m.memory_type}] ${m.title}`);
		continue;
	}
	totalClaims += result.claims.length;
	const sourceIds = extractIdentifiers(`${m.title}\n${m.body}`);
	const claimIds = new Set();
	for (const c of result.claims) for (const id of extractIdentifiers(c.fact)) claimIds.add(id);
	totalSourceIdentifiers += sourceIds.length;
	totalCoveredIdentifiers += sourceIds.filter((id) => claimIds.has(id)).length;
	console.log(`ok     [${m.memory_type}] ${m.title} -> ${result.claims.length} claims`);
}

console.log(`\nsample: ${rows.length} memories`);
console.log(`  claims: ${totalClaims} total, ${(totalClaims / Math.max(1, rows.length - rejected)).toFixed(1)} avg per accepted memory`);
console.log(`  rejected: ${rejected}/${rows.length} (${((rejected / rows.length) * 100).toFixed(1)}%)`);
console.log(`  identifier coverage: ${totalCoveredIdentifiers}/${totalSourceIdentifiers} (${totalSourceIdentifiers ? ((totalCoveredIdentifiers / totalSourceIdentifiers) * 100).toFixed(1) : '0'}%)`);
workDb.close();
