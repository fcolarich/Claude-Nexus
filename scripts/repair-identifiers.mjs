/**
 * Repair `memories.identifiers` staleness left over from BEFORE the
 * sanitize()/nexus_mark_promoted identifier-preservation fix (ADR-20260809012750-1f).
 *
 * Those two paths used to rewrite title/body without touching `identifiers`,
 * so a memory sanitized or promoted before the fix landed can have a stale
 * (too-small) identifiers column relative to its current text — and a
 * distill merge made AFTER the fix but folding in one of those pre-fix-stale
 * memories still inherits the staleness, because set-union only recovers
 * what the SOURCE's identifiers column already had at merge time.
 *
 * Two-pass, both additive-only (union, never remove — safe to re-run):
 *
 *   Pass 1 (leaf repair): every row, identifiers = union(stored, extract(current title+body)).
 *     Fixes any row whose own current text names something its stored
 *     identifiers missed — the direct effect of the pre-fix sanitize/promote bug.
 *
 *   Pass 2 (merge propagation): every LIVE row that is itself a merge output
 *     (has originals pointing at it via superseded_by), identifiers =
 *     union(its own identifiers, union of all its (pass-1-repaired) originals'
 *     identifiers). Mirrors distill.ts's own merge-time set-union, applied
 *     retroactively so an already-made merge picks up what pass 1 just
 *     recovered in its sources.
 *
 * Usage: node scripts/repair-identifiers.mjs [--dry-run]
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, initializeSchema } from '../dist/core/database.js';
import { extractIdentifiers, unionIdentifiers } from '../dist/core/identifiers.js';

const dryRun = process.argv.includes('--dry-run');
const dbPath = join(homedir(), '.claude', 'memories', 'nexus.db');

const db = openDatabase(dbPath);
initializeSchema(db);

// ── Pass 1: leaf repair ──────────────────────────────────────────────
const allRows = db.prepare(`SELECT id, title, body, identifiers FROM memories`).all();
const update = db.prepare(`UPDATE memories SET identifiers = ? WHERE id = ?`);

let leafRepaired = 0;
let leafIdentifiersAdded = 0;

const applyLeaf = db.transaction((rows) => {
	for (const { id, title, body, identifiers } of rows) {
		const stored = JSON.parse(identifiers || '[]');
		const fresh = extractIdentifiers(`${title}\n${body}`);
		const union = unionIdentifiers(stored, fresh);
		if (union.length === stored.length) continue; // nothing new — union is a no-op
		leafRepaired++;
		leafIdentifiersAdded += union.length - stored.length;
		if (!dryRun) update.run(JSON.stringify(union), id);
	}
});
applyLeaf(allRows);

console.log(`pass 1 (leaf repair): ${dryRun ? 'would touch' : 'touched'} ${leafRepaired} memories, ${leafIdentifiersAdded} identifiers recovered from own text`);

// ── Pass 2: merge propagation ──────────────────────────────────────────
// Only live rows that folded in at least one original — mirrors audit-merges.mjs's own definition of "a merge".
const merges = db.prepare(`
	SELECT m.id, m.identifiers FROM memories m
	WHERE m.superseded_by IS NULL
	  AND EXISTS (SELECT 1 FROM memories o WHERE o.superseded_by = m.id)
`).all();
const originalsOf = db.prepare(`SELECT identifiers FROM memories WHERE superseded_by = ?`);

let mergesRepaired = 0;
let mergeIdentifiersAdded = 0;

const applyMerges = db.transaction((rows) => {
	for (const { id, identifiers } of rows) {
		const own = JSON.parse(identifiers || '[]');
		const originals = originalsOf.all(id).map((o) => JSON.parse(o.identifiers || '[]'));
		const union = unionIdentifiers(own, ...originals);
		if (union.length === own.length) continue;
		mergesRepaired++;
		mergeIdentifiersAdded += union.length - own.length;
		if (!dryRun) update.run(JSON.stringify(union), id);
	}
});
applyMerges(merges);

console.log(`pass 2 (merge propagation): ${dryRun ? 'would touch' : 'touched'} ${mergesRepaired} merges, ${mergeIdentifiersAdded} identifiers propagated from (repaired) sources`);

db.close();
