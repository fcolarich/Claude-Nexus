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

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openDatabase, initializeSchema } from '../dist/core/database.js';
import { distillMemories, mergePrompt } from '../dist/core/distill.js';
import { confirmMemoryDuplicate } from '../dist/core/memory-dedup-confirm.js';
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
// Health probe before each chunk. A local merge model that is resident but
// starved does not fail cleanly — it times out slowly, so the consecutive-failure
// abort never trips and chunks limp at a fraction of normal cluster yield.
//
// The probe sends a trivial prompt and waits. Free VRAM was tried first and is
// unusable as a gate: its meaning flips depending on whether Ollama currently
// has the model resident. A 12.6 GB "free" reading on a 16 GB card simply meant
// the 7.6 GB model had been idle-unloaded, while 790 MiB free with it loaded and
// warm answered in 0.9s. Those samples are not on the same scale and cannot be
// thresholded against each other. Asking the model whether it can answer
// measures the actual constraint — contention, throttling, a wedged runner.
// Per-call ceiling and retry policy for the merge model. See ollamaCall for why
// the answer to a timeout is a retry rather than a bigger ceiling.
//
// 60s is ~6-8x a healthy merge call (measured 5.3-9.8s) and ~4x a cold model
// load (15.7s). Lowered from 120s because the latency distribution is bimodal:
// healthy calls finish in single-digit seconds and wedged ones never return at
// all (a direct 300s probe also failed), so a lower ceiling detects the bad case
// just as reliably and sooner. Not lowered further — the failure modes are
// asymmetric. A high ceiling only wastes wall time, but one set below genuine
// contended latency fails every call, trips LLM_FAILURE_ABORT, and kills a sweep
// that would otherwise have finished slowly.
const llmTimeoutMs = Number(flag('--llm-timeout', 60)) * 1000;
const llmRetries = Number(flag('--llm-retries', 1));
const llmRetryPauseMs = Number(flag('--llm-retry-pause', 20)) * 1000;
const probeTimeoutMs = Number(flag('--probe-timeout', 60)) * 1000;
const pollSeconds = Number(flag('--vram-poll', 300));
// Wall-clock budget, checked at chunk boundaries and while parked waiting for the
// GPU. A nightly job must hand the machine back before the working day whether or
// not the sweep finished — the cursor makes stopping mid-sweep free.
const maxRuntimeMin = Number(flag('--max-runtime-min', 0));
const deadline = maxRuntimeMin ? Date.now() + maxRuntimeMin * 60_000 : null;
const outOfTime = () => deadline !== null && Date.now() >= deadline;

/**
 * The default extraction provider (claude-agent-sdk) spawns a fresh `claude` CLI
 * process per call — ~19s each, which dominates a whole-DB sweep. The merge and
 * sanitize prompts are mechanical compression, not judgment, so --merge-model
 * routes just this sweep at a local Ollama chat model. extraction_models.yaml and
 * the reflector are untouched.
 */
const ollamaCall = async (system, user) => {
	// One retry after a pause, rather than a longer ceiling. A healthy call is
	// 6-8s, so 120s is already 15-20x headroom — a call that exhausts it is wedged,
	// not slow, and waiting longer only delays LLM_FAILURE_ABORT (5 consecutive
	// failures = 10 min at 120s, 25 min at 300s). What a bigger ceiling cannot fix
	// but a retry can is a transient blip: a moment of GPU contention, or Ollama
	// swapping the model back in. Giving up on the first one discards a cluster
	// that would have merged fine seconds later.
	for (let attempt = 1; attempt <= llmRetries + 1; attempt++) {
		try {
			// NO response_format: json_object here, deliberately. It raised the merge
			// rate 50% -> 88%, and corrupted 91 memories doing it.
			//
			// Constrained decoding forces syntactically valid escapes. Given a path the
			// model cannot escape legally — C:\Fran_Unity\unity-workflow-optimization,
			// where \F and \u are not JSON escapes — it substitutes valid ones and eats
			// the following character, emitting C:\tran_Unity\nity-workflow-optimization.
			// That parses cleanly into C:<TAB>ran_Unity<LF>ity-workflow-optimization.
			// Verified side by side: without json_object the raw bytes are correct and
			// the parse fails loudly; with it the bytes are wrong and the parse succeeds.
			//
			// A loud failure costs one cluster, which the cursor re-offers later. Silent
			// corruption writes wrong data into memories whose originals are then
			// superseded. Never trade the first for the second in a destructive pass —
			// repairJsonEscapes handles the malformed output honestly instead.
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
				signal: AbortSignal.timeout(llmTimeoutMs),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			return data?.choices?.[0]?.message?.content ?? '';
		} catch (err) {
			const last = attempt > llmRetries;
			console.warn(`[llm] ${mergeModel} call failed (attempt ${attempt}/${llmRetries + 1}):`, err.message);
			if (!last) await new Promise(r => setTimeout(r, llmRetryPauseMs));
			if (last) return '';
		}
	}
	return '';
};

const callFn = mergeModel ? ollamaCall : callModel;

/** Free VRAM in MiB via nvidia-smi, or null when unavailable. Diagnostic only — see waitForBackend. */
function freeVram() {
	try {
		const out = execFileSync('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], {
			encoding: 'utf8', timeout: 15000,
		});
		const n = Number(out.trim().split('\n')[0]);
		return Number.isFinite(n) ? n : null;
	} catch {
		return null;  // no nvidia-smi (CPU box, non-NVIDIA) — never block on it
	}
}

/**
 * Can the merge model do REAL work right now? Latency in ms, or null.
 *
 * Deliberately runs an actual merge — same prompt builder, a two-memory cluster,
 * JSON output — rather than "reply with ok". A trivial 5-token probe passed
 * repeatedly while every real merge in the following chunk timed out: generating
 * one word and generating six identifier-dense sentences are not the same load,
 * so the cheap probe reported healthy on a backend that could not do the job.
 * A representative probe costs the same ~6-10s as one merge, once per poll.
 */
const PROBE_CLUSTER = [
	{ memory_type: 'convention', title: 'Indentation', body: 'Use tabs for indentation throughout the codebase.' },
	{ memory_type: 'convention', title: 'Line width', body: 'Keep lines under 120 characters; configure a ruler.' },
];

async function probeModel() {
	const listing = PROBE_CLUSTER
		.map((c, i) => `[${i + 1}] (${c.memory_type}) ${c.title}\n${c.body}`)
		.join('\n\n');
	const t0 = Date.now();
	try {
		const res = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: mergeModel,
				messages: [
					{ role: 'system', content: mergePrompt(PROBE_CLUSTER.length) },
					{ role: 'user', content: listing },
				],
				temperature: 0.2,
				stream: false,
			}),
			signal: AbortSignal.timeout(probeTimeoutMs),
		});
		if (!res.ok) return null;
		const data = await res.json();
		// Must actually produce something parseable — a 200 with empty content is
		// the same failure as a timeout, just faster.
		const text = data?.choices?.[0]?.message?.content ?? '';
		if (!text.includes('{')) return null;
		return Date.now() - t0;
	} catch {
		return null;
	}
}

async function waitForBackend() {
	if (!mergeModel) return;  // the agent-SDK path has no local resource to wait on
	let waited = 0;
	for (;;) {
		if (outOfTime()) return;  // deadline wins over waiting; the chunk loop then exits
		const ms = await probeModel();
		if (ms !== null) {
			if (waited) console.log(`[${stamp()}] ${mergeModel} responding in ${(ms / 1000).toFixed(1)}s after waiting ${Math.round(waited / 60)} min — resuming`);
			return;
		}
		if (!waited) {
			const free = freeVram();
			console.log(`[${stamp()}] waiting for ${mergeModel}: no reply within ${probeTimeoutMs / 1000}s` +
				`${free === null ? '' : ` (${free} MiB VRAM free)`} — retrying every ${pollSeconds}s`);
		}
		await new Promise(r => setTimeout(r, pollSeconds * 1000));
		waited += pollSeconds;
	}
}

/**
 * Single-instance lock. Concurrent sweeps do not corrupt anything — the cursor is
 * stamped per memory — but they compete for the same GPU, which is precisely the
 * contention that degrades a local merge model into slow timeouts. The scheduled
 * nightly task cannot see a hand-started run (MultipleInstances only guards task
 * instances), so the lock has to live here.
 */
const lockPath = join(process.cwd(), '.flow', 'distill-sweep.lock');
mkdirSync(dirname(lockPath), { recursive: true });

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

if (existsSync(lockPath)) {
	const held = JSON.parse(readFileSync(lockPath, 'utf8'));
	if (held.pid !== process.pid && alive(held.pid)) {
		console.error(`another sweep is already running (pid ${held.pid}, started ${held.started}) — exiting`);
		process.exit(0);  // not an error: the other run is doing the work
	}
	console.log(`clearing stale lock from pid ${held.pid}`);  // previous run died without cleanup
}
writeFileSync(lockPath, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
const releaseLock = () => { try { unlinkSync(lockPath); } catch { /* already gone */ } };
process.on('exit', releaseLock);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { releaseLock(); process.exit(130); });

const db = openDatabase();
initializeSchema(db);
console.log(`merge model: ${mergeModel ?? 'configured extraction model (extraction_models.yaml)'}`);

const totals = { chunks: 0, processed: 0, clusters: 0, created: 0, rejected: 0, merged: 0, sanitized: 0, zeroClusterChunks: 0 };
const stamp = () => new Date().toISOString().slice(11, 19);
let lastRemaining = Infinity;
let stalled = 0;
let backendFailures = 0;
let stopReason = 'max-chunks guard hit';

for (let chunk = 1; chunk <= maxChunks; chunk++) {
	await waitForBackend();
	if (outOfTime()) { stopReason = `time budget reached (${maxRuntimeMin} min) — stopping at a chunk boundary`; break; }
	const t0 = Date.now();
	const r = await distillMemories(
		db, { project, limit, dryRun }, undefined, callFn,
		(db, a, b) => confirmMemoryDuplicate(db, a, b, callFn) // same model as distillation itself, per convention
	);
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

	// distillMemories aborted mid-chunk on consecutive backend failures and handed
	// its unprocessed candidates back. Rolling straight into the next chunk would
	// just reproduce it, so park until the model answers again. The probe alone is
	// not enough here: the backend is intermittent, so it can pass the probe and
	// then fail once real merge prompts start.
	if (r.backendFailed) {
		backendFailures++;
		console.log(`[${stamp()}]   backend failed mid-chunk (${backendFailures}/3) — candidates were un-stamped, waiting before retry`);
		if (backendFailures >= 3) {
			stopReason = `ABORTED: backend failed mid-chunk on 3 consecutive chunks — nothing was consumed, safe to resume later`;
			break;
		}
		await new Promise(r => setTimeout(r, pollSeconds * 1000));
		continue;  // skip the progress checks below: this chunk did no real work
	}
	backendFailures = 0;

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
