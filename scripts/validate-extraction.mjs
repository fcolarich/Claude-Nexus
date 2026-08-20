/**
 * Permanent replacement for the one-off scratch extraction-comparison scripts
 * (scratch-vcc-compare.ts, scratch-run-tuned.ts, scratch-incremental-sim.ts, etc.,
 * removed in this change). Gates any future extract.ts SYSTEM_PROMPT change against
 * two known incremental-window extraction-completeness regressions:
 *
 *   - preference-crowding (NOTE-20260730134513-3b): a short, durable preference line
 *     failed to survive extraction when crowded by 5-9 dense technical lines in the
 *     same incremental window, despite surviving whole-session extraction.
 *   - phase-section-cue (FEAT-20260730150641-ad): "### Phase: <name>" sections must
 *     each be scanned independently -- a regression here means only the first phase's
 *     facts get extracted.
 *
 * Not part of `npm test` -- makes real extraction-model calls (cost + latency).
 * Run manually before landing any SYSTEM_PROMPT change:
 *
 *   npm run build && node scripts/validate-extraction.mjs
 */

import { extractMemories } from '../dist/capture/extract.js';

// Each case: fixture input text, plus the distinctive tokens/phrases that MUST
// survive into at least one extracted candidate's title+body. An array entry means
// any-of (alternate phrasings of the same fact).
const CASES = [
	{
		name: 'preference-crowding (NOTE-20260730134513-3b)',
		text: `### Phase: Implement

I fixed the null-pointer bug in src/parser.ts:88 by adding a guard before the
.trim() call. Ran the full suite afterward: 214 passed, 0 failed.

The build was failing with "Cannot find module '@types/node'" until I ran
npm install --save-dev @types/node, which pinned it at 20.11.3.

From now on, commit only on explicit user request.

Also reworked the retry loop in src/client.ts to use exponential backoff
starting at 250ms, capped at 8000ms, with a max of 5 attempts.

Config change: MAX_CONCURRENT_REQUESTS in config.yaml went from 4 to 12 after
load testing showed the API handles it fine up to that point.

Deployed to staging at commit a3f9c21 and verified the /health endpoint
returns 200.`,
		mustRetain: [['commit only on explicit user request', 'commit only when explicitly asked']],
	},
	{
		name: 'phase-section-cue (FEAT-20260730150641-ad)',
		text: `### Phase: Design

Decided to use a two-tier cache (in-memory LRU in front of SQLite) rather than
a single SQLite-backed cache, per ADR-042 -- the LRU absorbs read-heavy bursts
that were causing lock contention on the SQLite writer.

### Phase: Implement

Hit a tool quirk: better-sqlite3's prepared statements can't be reused across
:memory: database instances after a reconnect -- each reconnect needs a fresh
.prepare() call, or it throws "This statement has been finalized".

### Phase: Review

Decision: reject the proposed batch-write API in favor of per-row writes wrapped
in a single transaction -- the batch API's error handling couldn't report which
row in the batch failed, and per-row-in-a-transaction gives the same throughput
with granular failure attribution.`,
		mustRetain: [
			['ADR-042', 'two-tier cache'],
			['finalized', 'better-sqlite3'],
			['batch-write', 'per-row writes'],
		],
	},
];

function haystack(candidates) {
	return candidates.map(c => `${c.title}\n${c.body}`).join('\n\n').toLowerCase();
}

console.log(`validating extraction against ${CASES.length} known-regression fixture case(s)\n`);

let passed = 0;
let unsafe = 0;
let errored = 0;

for (const c of CASES) {
	let candidates;
	const t0 = Date.now();
	try {
		candidates = await extractMemories(c.text, { project: 'validate-extraction-harness', source: 'vcc' });
	} catch (err) {
		errored++;
		console.log(`FAIL  ${c.name}\n      call error: ${err.message}\n`);
		continue;
	}
	const secs = ((Date.now() - t0) / 1000).toFixed(1);

	const hay = haystack(candidates);
	const lost = c.mustRetain
		.filter(tok => {
			const forms = Array.isArray(tok) ? tok : [tok];
			return !forms.some(f => hay.includes(f.toLowerCase()));
		})
		.map(tok => (Array.isArray(tok) ? tok[0] : tok));

	if (lost.length) {
		unsafe++;
		console.log(`FAIL  ${c.name} (${secs}s)\n      DROPPED: ${lost.join(', ')}\n      extracted ${candidates.length} candidate(s): ${candidates.map(x => x.title).join(' | ')}\n`);
	} else {
		passed++;
		console.log(`pass  ${c.name} (${secs}s) — extracted ${candidates.length} candidate(s)\n`);
	}
}

console.log(`${passed}/${CASES.length} retained all facts, ${unsafe} lost fact(s) (regression), ${errored} failed to answer.`);
if (unsafe > 0) {
	console.log('VERDICT: REGRESSION — extraction is dropping known facts. Do not land this SYSTEM_PROMPT change.');
} else if (errored > 0) {
	console.log(`VERDICT: INCONCLUSIVE — ${errored}/${CASES.length} call(s) failed; re-run before trusting this result.`);
} else {
	console.log('VERDICT: safe — no known regression reproduced.');
}
process.exit(unsafe === 0 && errored === 0 ? 0 : 1);
