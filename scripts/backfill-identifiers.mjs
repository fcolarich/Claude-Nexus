/**
 * Phase 1 backfill — populate `memories.identifiers` for existing rows.
 *
 * Deterministic regex extraction only (src/core/identifiers.ts, imported from
 * the built dist/ so this always runs the current implementation — no LLM
 * call, no loss risk, fully reversible (this only ever ADDS to an empty
 * column; see _documents/design-structured-memory.md, Phase 1 backfill).
 *
 * Idempotent and additive-only by construction: only rows whose identifiers
 * column is still the migration default ('[]' or NULL) are touched. A row a
 * distill merge already wrote a set-union into is never overwritten by a
 * lesser body-only extraction — that would silently discard identifiers the
 * union already recovered from sources whose own text never mentioned them.
 *
 * Usage: node scripts/backfill-identifiers.mjs [--dry-run]
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, initializeSchema } from '../dist/core/database.js';
import { extractIdentifiers } from '../dist/core/identifiers.js';

const dryRun = process.argv.includes('--dry-run');
const dbPath = join(homedir(), '.claude', 'memories', 'nexus.db');

const db = openDatabase(dbPath);
initializeSchema(db); // ensures migration v12 has run (identifiers column exists)

const rows = db.prepare(`
	SELECT id, title, body FROM memories WHERE identifiers IS NULL OR identifiers = '[]'
`).all();

console.log(`${rows.length} memories eligible for identifier backfill (identifiers IS NULL OR '[]')`);

const update = db.prepare(`UPDATE memories SET identifiers = ? WHERE id = ?`);
let touched = 0;
let totalIdentifiers = 0;

const applyAll = db.transaction((items) => {
	for (const { id, title, body } of items) {
		const identifiers = extractIdentifiers(`${title}\n${body}`);
		if (identifiers.length === 0) continue; // leave '[]' as-is — nothing to add
		totalIdentifiers += identifiers.length;
		touched++;
		if (!dryRun) update.run(JSON.stringify(identifiers), id);
	}
});

applyAll(rows);

console.log(`${dryRun ? '[dry-run] would touch' : 'touched'} ${touched} memories, ${totalIdentifiers} identifiers extracted total`);
db.close();
