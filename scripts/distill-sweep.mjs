/**
 * Drive nexus distill to completion over a scope, one bounded chunk at a time.
 *
 * Exists because the long-lived MCP server process pins whatever dist/ build it
 * started with — this runs the current build directly. Each chunk advances the
 * `memories.distilled_at` cursor, so `eligibleRemaining` strictly decreases and
 * the loop terminates. `clusters === 0` is NOT a stop condition; it just means
 * that window had no clusterable pairs.
 *
 * Usage: node scripts/distill-sweep.mjs [--limit N] [--project SLUG] [--max-chunks N]
 *                                       [--merge-model OLLAMA_MODEL] [--dry-run]
 */

import { openDatabase, initializeSchema } from '../dist/core/database.js';
import { distillMemories } from '../dist/core/distill.js';
import { callModel } from '../dist/core/llm.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : args[i + 1];
};

const limit = Number(flag('--limit', 300));
const project = flag('--project', undefined);
const maxChunks = Number(flag('--max-chunks', 200));
const mergeModel = flag('--merge-model', undefined);
const dryRun = args.includes('--dry-run');

/**
 * The default extraction provider (claude-agent-sdk) spawns a fresh `claude` CLI
 * process per call — ~19s each, which dominates a whole-DB sweep. The merge and
 * sanitize prompts are mechanical compression, not judgment, so --merge-model
 * routes just this sweep at a local Ollama chat model. extraction_models.yaml and
 * the reflector are untouched.
 */
const ollamaCall = async (system, user) => {
	try {
		const res = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: mergeModel,
				messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
				temperature: 0.2,
				stream: false,
			}),
			signal: AbortSignal.timeout(120000),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		return data?.choices?.[0]?.message?.content ?? '';
	} catch (err) {
		console.warn(`[llm] ${mergeModel} call failed:`, err.message);
		return '';
	}
};

const callFn = mergeModel ? ollamaCall : callModel;

const db = openDatabase();
initializeSchema(db);
console.log(`merge model: ${mergeModel ?? 'configured extraction model (extraction_models.yaml)'}`);

const totals = { chunks: 0, processed: 0, clusters: 0, created: 0, rejected: 0, merged: 0, sanitized: 0, zeroClusterChunks: 0 };
const stamp = () => new Date().toISOString().slice(11, 19);
let lastRemaining = Infinity;
let stalled = 0;
let stopReason = 'max-chunks guard hit';

for (let chunk = 1; chunk <= maxChunks; chunk++) {
	const t0 = Date.now();
	const r = await distillMemories(db, { project, limit, dryRun }, undefined, callFn);
	const secs = ((Date.now() - t0) / 1000).toFixed(1);

	totals.chunks++;
	totals.processed += r.processed;
	totals.clusters += r.clusters;
	totals.created += r.created;
	totals.rejected += r.rejected;
	totals.merged += r.merged;
	totals.sanitized += r.sanitized;
	if (r.clusters === 0) totals.zeroClusterChunks++;

	console.log(
		`[${stamp()}] chunk ${chunk} (${secs}s) scope=${r.scope} processed=${r.processed} ` +
		`clusters=${r.clusters} created=${r.created} rejected=${r.rejected} merged=${r.merged} sanitized=${r.sanitized} ` +
		`remaining=${r.eligibleRemaining}`
	);

	if (dryRun) { stopReason = 'dry run — single chunk only'; break; }

	// The silent-failure mode from callModel(): clusters found but nothing written
	// means the extraction backend is unavailable. Rejections don't count as
	// written, so exclude them — an all-rejected chunk is a quality problem, not
	// an auth one, and is reported separately below.
	if (r.clusters > 0 && r.created === 0 && r.rejected === 0) {
		stopReason = `ABORTED: chunk ${chunk} found ${r.clusters} clusters but created 0 — probable auth/extraction-backend failure`;
		break;
	}
	// The real stall signal. processed === 0 with work outstanding means the
	// cursor predicate is not selecting anything — looping further is pointless.
	if (r.processed === 0 && r.eligibleRemaining > 0) {
		stopReason = `ABORTED: chunk ${chunk} examined 0 candidates with ${r.eligibleRemaining} remaining — cursor not advancing`;
		break;
	}
	// Remaining can tick UP without anything being wrong: the capture hooks write
	// new memories concurrently, and those are legitimately un-examined. Only a
	// sustained failure to make headway means capture is outrunning the sweep.
	if (r.eligibleRemaining >= lastRemaining) {
		stalled++;
		console.log(`[${stamp()}]   note: remaining did not drop (${lastRemaining} -> ${r.eligibleRemaining}); concurrent capture is outpacing this chunk (${stalled}/3)`);
		if (stalled >= 3) {
			stopReason = `ABORTED: no net progress across 3 consecutive chunks — capture is writing faster than the sweep clears`;
			break;
		}
	} else {
		stalled = 0;
	}
	lastRemaining = r.eligibleRemaining;

	if (r.eligibleRemaining === 0) { stopReason = 'sweep complete — nothing left un-examined'; break; }
}

console.log(`\n${stopReason}`);
const rejectRate = totals.clusters ? ((totals.rejected / totals.clusters) * 100).toFixed(1) : '0.0';
console.log(
	`totals: ${totals.chunks} chunks, ${totals.processed} examined, ${totals.clusters} clusters, ` +
	`${totals.created} consolidated, ${totals.rejected} rejected by coverage gate (${rejectRate}%), ` +
	`${totals.merged} folded in, ${totals.sanitized} tightened, ${totals.zeroClusterChunks} zero-cluster chunks`
);
db.close();
