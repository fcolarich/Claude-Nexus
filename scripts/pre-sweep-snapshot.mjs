/**
 * Take the pre-sweep safety snapshot and record the sweep anchor, together.
 *
 * Run this IMMEDIATELY before starting a distill sweep. The two outputs are
 * coupled on purpose: a snapshot without a matching anchor leaves you guessing
 * which `--since` to pass, and a stale anchor is worse than none — passing a
 * timestamp from an earlier session makes `rollback-distill.mjs` revert every
 * memory the capture hooks wrote in between, and makes `audit-merges.mjs` judge
 * merges the sweep never made.
 *
 * The anchor comes from SQLite's own clock, not the system clock, so it can't
 * drift from the timestamps distill actually writes.
 *
 * Usage: node scripts/pre-sweep-snapshot.mjs
 */

import Database from 'better-sqlite3';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const memDir = join(homedir(), '.claude', 'memories');
const db = new Database(join(memDir, 'nexus.db'));

// SQLite's clock, matching what distill stamps rows with.
const anchor = db.prepare(`SELECT datetime('now') t`).get().t;
const stamp = anchor.replace(/[: ]/g, '-');
const snapshot = join(memDir, `nexus.pre-sweep-${stamp}.db`);

// VACUUM INTO rather than a file copy: WAL means recent commits may not be in
// the .db file yet, so copying it would snapshot a stale database.
db.exec(`VACUUM INTO '${snapshot.replace(/\\/g, '/')}'`);

const live = db.prepare(`SELECT count(*) c FROM memories WHERE superseded_by IS NULL`).get().c;
const pending = db.prepare(
	`SELECT count(*) c FROM memories WHERE distilled_at IS NULL AND superseded_by IS NULL`
).get().c;
db.close();

const anchorFile = join(process.cwd(), '.flow', 'distill-sweep-anchor.json');
mkdirSync(join(process.cwd(), '.flow'), { recursive: true });
writeFileSync(anchorFile, JSON.stringify({ anchor, snapshot, live, pending }, null, 2) + '\n');

const mb = (statSync(snapshot).size / 1024 / 1024).toFixed(1);
console.log(`snapshot : ${snapshot}  (${mb} MB)`);
console.log(`anchor   : ${anchor}   <- pass this to --since`);
console.log(`state    : ${live} live, ${pending} awaiting examination`);
console.log(`recorded : ${anchorFile}`);
console.log(`\nrollback if the audit fails:`);
console.log(`  node scripts/rollback-distill.mjs --since '${anchor}'`);
