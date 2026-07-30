/**
 * Undo a distill sweep: restore folded originals and remove the merges.
 *
 * Safe because distill never DELETEs an original — it sets superseded_by and
 * records a 'refines' link from the new memory to each original. That link is
 * what identifies a distill merge here, rather than "recently created memory
 * with superseded children", which would also catch consolidate's work and the
 * reflector's normal writes.
 *
 * Also clears distilled_at across the window so a later sweep re-examines the
 * restored memories instead of skipping them as already-seen.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write. Everything runs in one transaction.
 *
 * Usage: node scripts/rollback-distill.mjs --since 'YYYY-MM-DD HH:MM:SS' [--until '...'] [--apply]
 */

// openDatabase (not a raw better-sqlite3 handle) because deleting a memory fires
// the memories_vec_ad trigger, which needs the sqlite-vec extension loaded.
import { openDatabase } from '../dist/core/database.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : args[i + 1];
};
const since = flag('--since', undefined);
const until = flag('--until', undefined);
const apply = args.includes('--apply');
// Clear the sweep cursor WITHOUT undoing merges. For a run that died mid-flight
// (dead model backend, killed process): the merges it did complete are fine, but
// candidates it stamped and never processed must become eligible again.
const cursorOnly = args.includes('--cursor-only');

if (!since) {
	console.error("refusing to run without --since: 'YYYY-MM-DD HH:MM:SS'");
	process.exit(2);
}

const db = openDatabase();

const windowClause = `created_at >= :since ${until ? `AND created_at < :until` : ``}`;
const params = { since, ...(until ? { until } : {}) };

// A distill merge: created in the window AND the source of a 'refines' link.
// Not filtered on superseded_by IS NULL — a merge from an early chunk can have
// been folded into a later chunk's merge, and those chains must unwind too.
const merges = db.prepare(`
	SELECT id, title, created_at, source_session_id FROM memories
	WHERE ${windowClause}
	  AND EXISTS (SELECT 1 FROM memory_links l WHERE l.source_id = memories.id AND l.link_type = 'refines')
`).all(params);

// distill's insertMemory passes source_session_id: null; anything the reflector
// captured carries one. A hit here means the 'refines' filter caught a real
// memory from this session, and deleting it would destroy new work.
const suspect = merges.filter(m => m.source_session_id !== null);
if (suspect.length) {
	console.error(`ABORT: ${suspect.length} candidate(s) have a source_session_id and are not distill output:`);
	for (const s of suspect.slice(0, 10)) console.error(`  ${s.id}  ${s.title}`);
	process.exit(1);
}

const mergeIds = new Set(merges.map(m => m.id));

// Originals pointing at any of those merges. Counted directly rather than
// trusting the sweep's own log, which double-counts across chunks.
const placeholders = merges.map(() => '?').join(',');
const originals = merges.length
	? db.prepare(`SELECT id, superseded_by FROM memories WHERE superseded_by IN (${placeholders})`).all(...mergeIds)
	: [];

const stamped = db.prepare(
	`SELECT COUNT(*) c FROM memories WHERE distilled_at IS NOT NULL AND distilled_at >= :since ${until ? `AND distilled_at < :until` : ``}`
).get(params).c;

console.log(`window: ${since}${until ? ` .. ${until}` : ' .. now'}${cursorOnly ? '  [CURSOR ONLY — merges kept]' : ''}`);
if (cursorOnly) {
	console.log(`  ${merges.length} distill merges KEPT (not touched)`);
} else {
	console.log(`  ${merges.length} distill merges to remove`);
	console.log(`  ${originals.length} folded originals to restore (superseded_by -> NULL)`);
}
console.log(`  ${stamped} distilled_at stamps to clear (so a later sweep re-examines them)`);

// An original that is itself a window merge gets deleted, not restored — guard
// against reporting it as recovered.
const orphaned = originals.filter(o => mergeIds.has(o.id)).length;
if (orphaned) console.log(`  (${orphaned} of those are themselves window merges — chained, will be deleted not restored)`);

if (!apply) {
	console.log('\nDRY RUN — nothing written. Re-run with --apply to execute.');
	db.close();
	process.exit(0);
}

// VACUUM INTO rather than a file copy: WAL means recent commits may not be in
// the .db file yet, so copying it would snapshot a stale database.
const backup = join(homedir(), '.claude', 'memories', `nexus.pre-rollback-${Date.now()}.db`);
db.exec(`VACUUM INTO '${backup.replace(/\\/g, '/')}'`);
console.log(`\nsnapshot written: ${backup}`);

const run = db.transaction(() => {
	if (!cursorOnly) {
		// Order matters: clear the pointers before deleting the targets, so the
		// superseded_by FK (ON DELETE SET NULL) never has to do it implicitly.
		const restore = db.prepare(`UPDATE memories SET superseded_by = NULL WHERE superseded_by = ?`);
		for (const id of mergeIds) restore.run(id);

		const dropLinks = db.prepare(`DELETE FROM memory_links WHERE source_id = ? OR target_id = ?`);
		const dropMerge = db.prepare(`DELETE FROM memories WHERE id = ?`);
		for (const id of mergeIds) { dropLinks.run(id, id); dropMerge.run(id); }
	}

	db.prepare(
		`UPDATE memories SET distilled_at = NULL WHERE distilled_at IS NOT NULL AND distilled_at >= :since ${until ? `AND distilled_at < :until` : ``}`
	).run(params);
});

run();

const leftover = db.prepare(
	`SELECT COUNT(*) c FROM memories WHERE superseded_by IS NOT NULL AND superseded_by NOT IN (SELECT id FROM memories)`
).get().c;

console.log(cursorOnly
	? `\napplied. ${merges.length} merges kept, ${stamped} cursor stamps cleared — those candidates are eligible again.`
	: `\napplied. ${merges.length} merges deleted, ${originals.length - orphaned} originals restored, ${stamped} cursor stamps cleared.`);
console.log(`dangling superseded_by pointers: ${leftover}${leftover ? ' — INVESTIGATE' : ''}`);
db.close();
