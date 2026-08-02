/**
 * Remove memories captured from sessions that today's exclusion rules would
 * have refused — book/article processing and distill-audit runs.
 *
 * Reuses classifyOrigin, so this pass and live capture can never disagree.
 * Resolution is source_session_id -> transcript .jsonl under ~/.claude/projects.
 *
 * FAILS CLOSED: a memory whose transcript no longer exists is reported and
 * KEPT, never deleted. Distill-generated merges (source_session_id IS NULL) are
 * out of scope — they have no session to classify.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write; a VACUUM INTO snapshot is taken
 * first and its path printed, which is the rollback.
 *
 * Usage: node scripts/purge-origin.mjs [--apply] [--out report.json]
 */

// openDatabase (not raw better-sqlite3): deleting a memory fires the
// memories_vec_ad trigger, which needs the sqlite-vec extension loaded.
import { openDatabase } from '../dist/core/database.js';
import { getNexusConfig } from '../dist/core/config.js';
import { classifyOrigin } from '../dist/capture/origin.js';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const outIdx = args.indexOf('--out');
const outPath = outIdx === -1 ? '.flow/purge-origin-report.json' : args[outIdx + 1];

const projectsDir = join(homedir(), '.claude', 'projects');
const cfg = getNexusConfig().exclude;
const db = openDatabase();

// Env opt-out must not leak into the purge: NEXUS_NO_CAPTURE describes THIS
// process, not the sessions being classified.
const env = { ...process.env, NEXUS_NO_CAPTURE: '' };

let projectDirs = [];
try { projectDirs = readdirSync(projectsDir); } catch { /* no transcripts at all */ }

const transcriptFor = (project, sessionId) => {
	if (project) {
		const direct = join(projectsDir, project, `${sessionId}.jsonl`);
		if (existsSync(direct)) return direct;
	}
	for (const d of projectDirs) {
		const p = join(projectsDir, d, `${sessionId}.jsonl`);
		if (existsSync(p)) return p;
	}
	return null;
};

const rows = db.prepare(`
	SELECT id, title, project, source_session_id
	FROM memories
	WHERE superseded_by IS NULL AND source_session_id IS NOT NULL
`).all();

const doomed = [];
const unresolved = [];
const sessionVerdicts = new Map();

for (const r of rows) {
	let verdict = sessionVerdicts.get(r.source_session_id);
	if (verdict === undefined) {
		const path = transcriptFor(r.project, r.source_session_id);
		verdict = path ? classifyOrigin(path, cfg, env) : null;
		sessionVerdicts.set(r.source_session_id, verdict);
	}
	if (verdict === null) unresolved.push(r);
	else if (verdict.excluded) doomed.push({ ...r, reason: verdict.reason });
}

const byReason = {};
for (const d of doomed) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;

const resolvedSessions = [...sessionVerdicts.values()].filter(v => v !== null).length;

console.log(`scanned      : ${rows.length} live memories with a session`);
console.log(`sessions     : ${sessionVerdicts.size} distinct (${resolvedSessions} transcripts found)`);
console.log(`unresolved   : ${unresolved.length} memories (transcript gone — KEPT)`);
console.log(`to remove    : ${doomed.length}`);
for (const [reason, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
	console.log(`   ${String(n).padStart(5)}  ${reason}`);
}

writeFileSync(outPath, JSON.stringify({ apply, byReason, doomed, unresolved }, null, 2));
console.log(`\nwrote report to ${outPath}`);

if (!apply) {
	console.log('\nDRY RUN — nothing written. Re-run with --apply to delete.');
	db.close();
	process.exit(0);
}

if (doomed.length === 0) {
	console.log('\nnothing to delete.');
	db.close();
	process.exit(0);
}

// VACUUM INTO rather than a file copy: WAL means recent commits may not be in
// the .db file yet, so copying it would snapshot a stale database.
const snapshot = join(homedir(), '.claude', 'memories', `nexus.pre-purge-${Date.now()}.db`);
db.exec(`VACUUM INTO '${snapshot.replace(/\\/g, '/').replace(/'/g, "''")}'`);
console.log(`\nsnapshot: ${snapshot}`);

const del = db.prepare('DELETE FROM memories WHERE id = ?');
const run = db.transaction((list) => { for (const d of list) del.run(d.id); });
run(doomed);

console.log(`deleted ${doomed.length} memories. Restore by replacing nexus.db with the snapshot above.`);
db.close();
