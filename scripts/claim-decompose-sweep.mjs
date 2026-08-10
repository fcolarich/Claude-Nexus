/**
 * Drive claim decomposition to completion over a scope, one bounded chunk at
 * a time. Mirrors distill-sweep.mjs's exact pattern (health probe, retry,
 * wall-clock budget, single-instance lock, cursor-driven termination) applied
 * to decomposeMemoriesToClaims() / memories.claims_extracted_at instead of
 * distillMemories() / distilled_at.
 *
 * Full-population decomposition is a many-hour job (measured throughput on
 * the pass-bar samples: ~10-30s/call with real backend contention) — this
 * script is what makes that resumable rather than an all-or-nothing run.
 *
 * NOT wired into any scheduled task. Run explicitly.
 *
 * Usage: node scripts/claim-decompose-sweep.mjs [--limit N] [--project SLUG] [--max-chunks N]
 *                                               [--merge-model OLLAMA_MODEL] [--dry-run]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openDatabase, initializeSchema } from '../dist/core/database.js';
import { decomposeMemoriesToClaims } from '../dist/core/claims-sweep.js';
import { claimExtractPrompt } from '../dist/capture/claim-extract.js';
import { callModel } from '../dist/core/llm.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : args[i + 1];
};

const limit = Number(flag('--limit', 150));
const project = flag('--project', undefined);
const maxChunks = Number(flag('--max-chunks', 200));
const mergeModel = flag('--merge-model', undefined);
const dryRun = args.includes('--dry-run');

// Same rationale as distill-sweep.mjs: a resident-but-starved local model
// times out slowly rather than failing cleanly, so the probe must run a real
// extraction call, not a trivial ping.
const llmTimeoutMs = Number(flag('--llm-timeout', 60)) * 1000;
const llmRetries = Number(flag('--llm-retries', 1));
const llmRetryPauseMs = Number(flag('--llm-retry-pause', 20)) * 1000;
const probeTimeoutMs = Number(flag('--probe-timeout', 60)) * 1000;
const pollSeconds = Number(flag('--vram-poll', 300));
const maxRuntimeMin = Number(flag('--max-runtime-min', 0));
const deadline = maxRuntimeMin ? Date.now() + maxRuntimeMin * 60_000 : null;
const outOfTime = () => deadline !== null && Date.now() >= deadline;

const ollamaCall = async (system, user) => {
	for (let attempt = 1; attempt <= llmRetries + 1; attempt++) {
		try {
			// NO response_format: json_object here, deliberately (q-007, ADR history).
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

function freeVram() {
	try {
		const out = execFileSync('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], {
			encoding: 'utf8', timeout: 15000,
		});
		const n = Number(out.trim().split('\n')[0]);
		return Number.isFinite(n) ? n : null;
	} catch {
		return null;
	}
}

// Probes with a real (trivial) extraction call — same shape as production
// claim-extraction, so a resident-but-starved model is caught the same way
// distill-sweep.mjs's probeModel() catches it.
const PROBE_MEMORY = 'Use tabs for indentation throughout the codebase.';

async function probeModel() {
	const t0 = Date.now();
	try {
		const res = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: mergeModel,
				messages: [
					{ role: 'system', content: claimExtractPrompt() },
					{ role: 'user', content: `<memory-text>\n${PROBE_MEMORY}\n</memory-text>` },
				],
				temperature: 0.2,
				stream: false,
			}),
			signal: AbortSignal.timeout(probeTimeoutMs),
		});
		if (!res.ok) return null;
		const data = await res.json();
		const text = data?.choices?.[0]?.message?.content ?? '';
		if (!text.includes('[')) return null;
		return Date.now() - t0;
	} catch {
		return null;
	}
}

async function waitForBackend() {
	if (!mergeModel) return;
	let waited = 0;
	for (;;) {
		if (outOfTime()) return;
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
 * Single-instance lock, separate from distill-sweep.lock. The two sweeps
 * compete for the same GPU if both are launched — this only prevents two
 * copies of THIS sweep, matching distill-sweep.mjs's own scope.
 */
const lockPath = join(process.cwd(), '.flow', 'claim-decompose-sweep.lock');
mkdirSync(dirname(lockPath), { recursive: true });

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

if (existsSync(lockPath)) {
	const held = JSON.parse(readFileSync(lockPath, 'utf8'));
	if (held.pid !== process.pid && alive(held.pid)) {
		console.error(`another claim-decompose sweep is already running (pid ${held.pid}, started ${held.started}) — exiting`);
		process.exit(0);
	}
	console.log(`clearing stale lock from pid ${held.pid}`);
}
writeFileSync(lockPath, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
const releaseLock = () => { try { unlinkSync(lockPath); } catch {} };
process.on('exit', releaseLock);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { releaseLock(); process.exit(130); });

const db = openDatabase();
initializeSchema(db);
console.log(`extraction model: ${mergeModel ?? 'configured extraction model (extraction_models.yaml)'}`);

const totals = { chunks: 0, processed: 0, accepted: 0, rejected: 0, claimsWritten: 0 };
const stamp = () => new Date().toISOString().slice(11, 19);
let lastRemaining = Infinity;
let stalled = 0;
let backendFailures = 0;
let stopReason = 'max-chunks guard hit';

for (let chunk = 1; chunk <= maxChunks; chunk++) {
	await waitForBackend();
	if (outOfTime()) { stopReason = `time budget reached (${maxRuntimeMin} min) — stopping at a chunk boundary`; break; }
	const t0 = Date.now();
	const r = dryRun
		? { processed: 0, accepted: 0, rejected: 0, claimsWritten: 0, backendFailed: false, eligibleRemaining: 0 }
		: await decomposeMemoriesToClaims(db, { project, limit }, callFn);
	const secs = ((Date.now() - t0) / 1000).toFixed(1);

	totals.chunks++;
	totals.processed += r.processed;
	totals.accepted += r.accepted;
	totals.rejected += r.rejected;
	totals.claimsWritten += r.claimsWritten;

	console.log(
		`[${stamp()}] chunk ${chunk} (${secs}s) processed=${r.processed} accepted=${r.accepted} ` +
		`rejected=${r.rejected} claims=${r.claimsWritten} remaining=${r.eligibleRemaining}`
	);

	if (dryRun) { stopReason = 'dry run — single chunk only'; break; }

	if (r.backendFailed) {
		backendFailures++;
		console.log(`[${stamp()}]   backend failed mid-chunk (${backendFailures}/3) — candidates were un-stamped, waiting before retry`);
		if (backendFailures >= 3) {
			stopReason = `ABORTED: backend failed mid-chunk on 3 consecutive chunks — nothing was consumed, safe to resume later`;
			break;
		}
		await new Promise(r => setTimeout(r, pollSeconds * 1000));
		continue;
	}
	backendFailures = 0;

	if (r.processed === 0 && r.eligibleRemaining > 0) {
		stopReason = `ABORTED: chunk ${chunk} examined 0 candidates with ${r.eligibleRemaining} remaining — cursor not advancing`;
		break;
	}
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
const rejectRate = totals.processed ? ((totals.rejected / totals.processed) * 100).toFixed(1) : '0.0';
console.log(
	`totals: ${totals.chunks} chunks, ${totals.processed} examined, ${totals.accepted} accepted, ` +
	`${totals.rejected} rejected (${rejectRate}%), ${totals.claimsWritten} claims written`
);
db.close();
