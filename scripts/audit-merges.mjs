/**
 * Audit real distill merges for fact loss across the whole DB.
 *
 * scripts/check-merge-model.mjs gates a model on synthetic cases before a sweep.
 * This checks what actually happened afterwards: for each sampled merge it pulls
 * the originals it superseded, extracts their DISTINCTIVE tokens (identifiers,
 * paths, versions, multi-digit numbers, CamelCase, CONST_NAMES, backticked
 * spans), and reports any that did not survive into the merged text.
 *
 * Prose rewording is expected and fine — that is the point of distill. A missing
 * identifier or number is not: the originals are already superseded, so the fact
 * is gone.
 *
 * Read-only. Safe to run against a live DB while a sweep is in progress.
 *
 * Usage: node scripts/audit-merges.mjs [--sample N] [--since 'YYYY-MM-DD HH:MM:SS'] [--verbose]
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : args[i + 1];
};
const sample = Number(flag('--sample', 40));
const since = flag('--since', undefined);
const until = flag('--until', undefined);  // bound the window to compare one model's merges against another's
const verbose = args.includes('--verbose');
// --strict counts only code-like identifiers that cannot be legitimately reworded:
// file names, paths, snake_case, digits, CamelCase, CONST_NAMES. Without it,
// plain hyphenated English ("self-contained", "end-to-end") also counts, which
// inflates loss — a merge is allowed to reword prose.
const strict = args.includes('--strict');

// --db points at a snapshot (e.g. nexus.pre-rollback-*.db) so a prompt change can
// be measured against the merges it replaced, under identical extraction rules.
const dbPath = flag('--db', join(homedir(), '.claude', 'memories', 'nexus.db'));
const db = new Database(dbPath, { readonly: true });
// memories_vec is a vec0 virtual table — unreadable without the extension.
try { sqliteVec.load(db); } catch { /* coverage scoring degrades to skipped */ }

const all = args.includes('--all');           // scan every merge, not a sample
const outPath = flag('--out', undefined);     // write flagged merges as JSON for later agent review
// Cosine floor below which a source counts as under-represented in its merge.
// Calibrated from the observed distribution over 855 real merges (2026-07-26):
// minCos p10 0.77, p50 0.84, p90 0.88 — tight, so 0.72 flags the genuine tail
// (~1.5%) rather than an arbitrary fraction.
const coverageFloor = Number(flag('--coverage-floor', 0.72));

// A merge = a live memory that has originals pointing at it via superseded_by.
const merges = db.prepare(`
	SELECT m.id, m.rowid AS rowid, m.title, m.body, m.project, m.created_at,
	       (SELECT COUNT(*) FROM memories o WHERE o.superseded_by = m.id) AS folded
	FROM memories m
	WHERE m.superseded_by IS NULL
	  AND EXISTS (SELECT 1 FROM memories o WHERE o.superseded_by = m.id)
	  ${since ? `AND m.created_at >= :since` : ``}
	  ${until ? `AND m.created_at < :until` : ``}
	ORDER BY ${all ? `m.created_at` : `RANDOM()`}
	${all ? `` : `LIMIT :sample`}
`).all({ sample, ...(since ? { since } : {}), ...(until ? { until } : {}) });

const originalsOf = db.prepare(`SELECT id, rowid AS rowid, title, body FROM memories WHERE superseded_by = ?`);
const vecOf = db.prepare(`SELECT embedding FROM memories_vec WHERE rowid = ?`);

/**
 * Cosine coverage: how well the merged text represents EACH source it folded in.
 * Vectors are stored already normalized (memories.ts embedMemory -> normalize),
 * so cosine is a plain dot product — no extra embedding calls needed.
 *
 * This is the signal identifier-matching cannot see. A merge that echoes one
 * source and ignores another keeps flawless prose while losing a whole memory —
 * exactly how qwen2.5vl failed the pre-sweep gate. The MINIMUM cosine across
 * sources is what matters: a genuine blend sits moderately against all of them,
 * whereas an ignored source falls well below its siblings.
 */
function loadVec(rowid) {
	let row;
	try { row = vecOf.get(rowid); } catch { return null; }
	if (!row?.embedding) return null;
	const b = row.embedding;
	return new Float32Array(b.buffer, b.byteOffset, b.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

function cosine(a, b) {
	let dot = 0;
	for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
	return dot;
}

// Population the sample is drawn from, and — critically — whether the folded
// originals still exist. distill sets superseded_by; it never DELETEs, so a bad
// sweep is reversible by clearing that column.
const pop = db.prepare(`
	SELECT COUNT(*) AS merges,
	       (SELECT COUNT(*) FROM memories o
	         WHERE o.superseded_by IN (
	           SELECT m2.id FROM memories m2
	           WHERE m2.superseded_by IS NULL
	             ${since ? `AND m2.created_at >= :since` : ``}
	             ${until ? `AND m2.created_at < :until` : ``}
	         )) AS folded_originals_still_present
	FROM memories m
	WHERE m.superseded_by IS NULL
	  AND EXISTS (SELECT 1 FROM memories o WHERE o.superseded_by = m.id)
	  ${since ? `AND m.created_at >= :since` : ``}
	  ${until ? `AND m.created_at < :until` : ``}
`).get({ ...(since ? { since } : {}), ...(until ? { until } : {}) });
console.log(`population: ${pop.merges} merges in window, ${pop.folded_originals_still_present} folded originals still present (recoverable)\n`);

const PATTERNS = [
	/`[^`]{2,60}`/g,                                        // backticked spans
	/\b[A-Za-z_][A-Za-z0-9_]*(?:[._\/-][A-Za-z0-9_]+)+\b/g, // dotted / pathed / snake identifiers
	/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g,                     // CamelCase
	/\b[A-Z]{3,}(?:_[A-Z0-9]+)*\b/g,                        // ALLCAPS / CONST_NAMES
	/\b\d+\.\d+\b/g,                                        // decimals (0.35, 4.5)
	/\b\d{2,}\b/g,                                          // multi-digit numbers
];

// Punctuation-ish matches the identifier pattern catches but that carry no fact.
const NOISE = new Set(['e.g', 'e.g.', 'i.e', 'i.e.', 'etc', 'vs', 'ie', 'eg']);

// ALLCAPS emphasis in memory bodies ("do NOT", "source text ONLY"), not identifiers.
const EMPHASIS = new Set([
	'NOT', 'ONLY', 'ALL', 'ANY', 'AND', 'THE', 'MUST', 'NEVER', 'ALWAYS', 'BUT',
	'YES', 'NO', 'USE', 'DO', 'DONT', 'NOTE', 'WARNING', 'IMPORTANT', 'STRICT',
]);

// Written-out forms of small numbers, so "20" -> "twenty" counts as retained
// rather than as information loss.
const NUMBER_WORDS = {
	2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight',
	9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve', 20: 'twenty', 30: 'thirty',
	100: 'hundred', 1000: 'thousand',
};

function distinctiveTokens(text) {
	const out = new Set();
	for (const re of PATTERNS) {
		for (const m of text.matchAll(re)) {
			// Strip backticks and any wrapping quotes/punctuation: a body containing
			// `systems-thinking-mental-models` does retain a source's
			// `"systems-thinking-mental-models"`, and counting that as loss is noise.
			const tok = m[0].replace(/`/g, '').replace(/^["'(\[{,.:;]+|["')\]},.:;]+$/g, '').trim();
			if (tok.length < 3) continue;
			if (NOISE.has(tok.toLowerCase())) continue;
			if (strict) {
				// Plain English words joined by - or / at any capitalisation
				// ("Mission-driven", "retention/recall"): reworadable prose, not an
				// identifier. A real identifier carries a dot, underscore, digit, or
				// internal capital (build_queue.py, RCP-vfx-004, book-queue.json).
				if (/^[A-Za-z]+(?:[-\/][A-Za-z]+)+$/.test(tok) && !/[._\d]/.test(tok) && !/[a-z][A-Z]/.test(tok)) continue;
				if (EMPHASIS.has(tok.toUpperCase()) && tok === tok.toUpperCase()) continue;
			}
			out.add(tok);
		}
	}
	return [...out];
}

function retained(tok, hay) {
	const t = tok.toLowerCase();
	if (hay.includes(t)) return true;
	// A dotted/pathed identifier survives if its most specific segment does —
	// "src/mcp/server.ts" rewritten as "server.ts" has not lost the fact.
	if (/[._\/-]/.test(t)) {
		const segs = t.split(/[._\/-]+/).filter(s => s.length >= 4);
		if (segs.length && segs.every(s => hay.includes(s))) return true;
	}
	const word = NUMBER_WORDS[Number(t)];
	if (word && hay.includes(word)) return true;
	return false;
}

let clean = 0;
const flagged = [];
const allCos = [];
const pairCos2 = [];  // exact: single gated pair
const pairCos3 = [];  // upper bound: tightest pair may be two non-head members
let totalTokens = 0;
let totalLost = 0;

for (const m of merges) {
	const originals = originalsOf.all(m.id);
	if (!originals.length) continue;

	const tokens = new Set();
	for (const o of originals) for (const t of distinctiveTokens(`${o.title}\n${o.body}`)) tokens.add(t);

	// Coverage: cosine of the merge against each source it folded in.
	const mv = loadVec(m.rowid);
	let minCos = null, worstSource = null, cosList = [];
	if (mv) {
		for (const o of originals) {
			const ov = loadVec(o.rowid);
			if (!ov || ov.length !== mv.length) continue;
			const c = cosine(mv, ov);
			cosList.push(c);
			if (minCos === null || c < minCos) { minCos = c; worstSource = o.title; }
		}
	}

	const hay = `${m.title}\n${m.body}`.toLowerCase();
	const lost = [...tokens].filter(t => !retained(t, hay));

	totalTokens += tokens.size;
	totalLost += lost.length;

	// Tightest source-to-source similarity in this cluster. distill's BAND_LOW is
	// applied head-to-candidate at cluster time, so this is what a proposed band
	// change would have excluded — the direct cost of raising the threshold.
	if (mv && originals.length > 1) {
		const ovs = originals.map(o => loadVec(o.rowid)).filter(v => v && v.length === mv.length);
		let worst = null;
		for (let i = 0; i < ovs.length; i++)
			for (let j = i + 1; j < ovs.length; j++) {
				const c = cosine(ovs[i], ovs[j]);
				if (worst === null || c < worst) worst = c;
			}
		// For a 2-source merge the single pair IS the head-to-candidate comparison
		// BAND_LOW gated, so it is an exact reading. With 3 sources the tightest pair
		// may be two non-head members that never had to clear the band, making the
		// "worst" figure an upper bound on impact rather than the impact.
		if (worst !== null) (originals.length === 2 ? pairCos2 : pairCos3).push(worst);
	}

	const lossRate = tokens.size ? lost.length / tokens.size : 0;
	if (minCos !== null) allCos.push(minCos);

	const identifierBad = lossRate >= 0.25;
	const coverageBad = minCos !== null && minCos < coverageFloor;

	if (!identifierBad && !coverageBad && lost.length === 0) {
		clean++;
		if (verbose) console.log(`ok    [${m.project ?? 'global'}] ${m.title}  (${m.folded} folded, ${tokens.size} tokens, minCos ${minCos?.toFixed(2) ?? '—'})`);
	} else if (lost.length || coverageBad) {
		flagged.push({ ...m, lost, tokenCount: tokens.size, lossRate, minCos, worstSource, cosList, identifierBad, coverageBad });
	}
}

// Worst first, coverage failures ahead of identifier-only ones: a dropped source
// is a whole memory lost, a dropped token is part of one.
flagged.sort((a, b) => (Number(b.coverageBad) - Number(a.coverageBad)) || (b.lossRate - a.lossRate));

for (const f of flagged) {
	const cov = f.minCos === null ? 'no vector' : `minCos ${f.minCos.toFixed(2)}${f.coverageBad ? ` UNDER-REPRESENTED: "${f.worstSource}"` : ''}`;
	console.log(
		`${f.coverageBad ? 'COVER' : 'LOSS '} [${f.project ?? 'global'}] ${f.title}\n` +
		`      ${f.lost.length}/${f.tokenCount} distinctive tokens missing (${(f.lossRate * 100).toFixed(0)}%), ${f.folded} folded, ${cov}\n` +
		(f.lost.length ? `      dropped: ${f.lost.slice(0, 12).join(', ')}${f.lost.length > 12 ? ', …' : ''}\n` : '') +
		`      merged:  ${f.body.slice(0, 220)}\n`
	);
}

const audited = clean + flagged.length;
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '0.0');
console.log(`\naudited ${audited} merges${since ? ` created since ${since}` : ''}`);
console.log(`  ${clean} clean, ${flagged.length} flagged`);
console.log(`  identifiers: ${totalLost}/${totalTokens} dropped (${pct(totalLost, totalTokens)}%), ${flagged.filter(f => f.identifierBad).length} merge(s) over 25%`);

if (allCos.length) {
	const sorted = [...allCos].sort((a, b) => a - b);
	const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
	const under = flagged.filter(f => f.coverageBad).length;
	console.log(`  coverage:    minCos p10 ${at(0.1).toFixed(2)}, p50 ${at(0.5).toFixed(2)}, p90 ${at(0.9).toFixed(2)} over ${allCos.length} merges`);
	console.log(`               ${under} merge(s) below the ${coverageFloor} floor — a folded source is under-represented`);
} else {
	console.log(`  coverage:    unavailable (no vectors readable — is sqlite-vec loaded?)`);
}

if (pairCos2.length || pairCos3.length) {
	const band = Number(flag('--band', 0.75));
	const spread = list => {
		const s = [...list].sort((a, b) => a - b);
		const at = q => s[Math.min(s.length - 1, Math.floor(q * s.length))];
		return `p10 ${at(0.1).toFixed(2)}, p50 ${at(0.5).toFixed(2)}`;
	};
	if (pairCos2.length) {
		const below = pairCos2.filter(c => c < band).length;
		console.log(`  clustering:  2-source merges (exact — the gated pair): ${spread(pairCos2)} over ${pairCos2.length}`);
		console.log(`               ${below} (${pct(below, pairCos2.length)}%) below BAND_LOW ${band} — would no longer cluster`);
	}
	if (pairCos3.length) {
		const below = pairCos3.filter(c => c < band).length;
		console.log(`               3-source merges (UPPER BOUND — tightest pair may be two non-head members): ${spread(pairCos3)} over ${pairCos3.length}, ${below} (${pct(below, pairCos3.length)}%) below`);
	}
}

if (outPath) {
	// Deliberately includes the originals' text: a reviewing agent needs to judge
	// semantic loss without re-querying, and the originals are only a superseded_by
	// flag away from being invisible.
	const payload = flagged.map(f => ({
		id: f.id, project: f.project, title: f.title, body: f.body, created_at: f.created_at,
		folded: f.folded, lostIdentifiers: f.lost, identifierLossRate: Number(f.lossRate.toFixed(3)),
		minCosine: f.minCos === null ? null : Number(f.minCos.toFixed(3)),
		underRepresentedSource: f.coverageBad ? f.worstSource : null,
		reason: [f.identifierBad && 'identifier-loss', f.coverageBad && 'source-under-represented'].filter(Boolean),
		originals: originalsOf.all(f.id).map(o => ({ id: o.id, title: o.title, body: o.body })),
	}));
	writeFileSync(outPath, JSON.stringify(payload, null, 2));
	console.log(`\nwrote ${payload.length} flagged merge(s) + their originals to ${outPath}`);
}
db.close();
