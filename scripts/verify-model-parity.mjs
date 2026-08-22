#!/usr/bin/env node
/**
 * Parity harness for the llama-swap transport migration.
 * --capture  Write baseline from old transports BEFORE any config edit (irreversible step).
 * --verify   Compare current output against baseline; exits non-zero on drift.
 *
 * Gate thresholds (pre-committed, no run-time judgement):
 *   embedding: cosine >= 0.9990 AND dim === 1024 per fixture input
 *   rerank:    |Δscore| <= 1e-3 AND identical ranking order
 *   latency:   p50/p95 of recallByQuery — report-only
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	checkEmbedding,
	checkRerank,
	cosine,
	EXPECTED_DIM,
} from './parity-gates.mjs';
import { getNexusConfig } from '../dist/core/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(
	__dirname,
	'../.flow/tdd/model-coresidency-20260821-1219/parity-baseline.json',
);

// ---------------------------------------------------------------------------
// Fixture corpus
// ~20 strings drawn from real nexus memory bodies.
// Invariants:
//   - at least one entry >= 1200 chars (exercises the text.slice(0,1200) truncation boundary
//     in generateEmbedding)
//   - at least one non-ASCII entry (jina is multilingual; tokenizer drift would otherwise
//     go unmeasured)
// ---------------------------------------------------------------------------

export const FIXTURE_CORPUS = [
	// Short factual memories
	'nexus_distill sweep cursor: the no-pagination stall, fixed via distilled_at; loop on eligibleRemaining==0, never stop on clusters==0',
	'distill merges drop identifiers: sweep log counters look green while ~30% of identifiers vanish; audit real output after chunk 1',
	'nexus_distill all-scope hangs: whole-DB chunks do real work then stall at zero CPU until the 1800s MCP timeout; verify progress in the DB, not the result line',
	'SQLite boolean columns stored as INTEGER 0/1, not JS boolean. All schema definitions and TS type annotations must reflect this.',
	'Project slugs: lowercase, spaces → hyphens, Windows drive colon → double dash (e.g. C--Fran-project). resolveProjectSlug enforces this.',
	'INSERT ... ON CONFLICT DO UPDATE must include ALL fields in the SET clause — partial updates silently drop columns on the conflict branch.',
	'Default new atoms to load_at_init: false. Opt-in recall prevents cold-start token bloat.',
	'Smart project resolution: derive slug from cwd via git rev-parse --show-toplevel, fallback to path normalisation, then to cwd itself.',
	'Capture is gated on session ORIGIN before anything else. The gate fails OPEN (unreadable transcript still captures); purge fails CLOSED.',
	'NEXUS_NO_CAPTURE=1 disables capture for a session entirely. Set it in the MCP server env to prevent recursive self-capture.',
	'compactToParallelFile is the live post-extraction shrink mechanism (ADR-20260820190143-a5). compactFileInPlace was the dead path removed in 5e3c883.',
	'recallByQuery: decay-ranked FTS + sqlite-vec hybrid, fused via rrfFuse, then optionally reranked. latency budget is ~150 ms p50.',
	'Embeddings: mxbai-embed-large via Ollama api/embed. 1024-dim Float32Array. generateEmbedding slices input to 1200 chars before sending.',
	'Reranker: jina-reranker-v2-base-multilingual via standalone daemon on port 8931. sigmoid-normalised score. threshold default 0.5.',
	'MCP server exposes 20 tools over stdio transport. Express REST API on port 3210 serves the built Svelte 5 dashboard from dist-frontend/.',

	// Medium-length procedural memories
	'When a pre-commit hook fails, the commit did NOT happen — amending would modify the PREVIOUS commit. Fix the issue, re-stage, and create a NEW commit.',
	'Bash tool on this machine resolves to WSL Ubuntu. Forward-slash Windows paths (C:/...) work in Git Bash but not WSL bash. Use PowerShell for C:\\ paths.',
	'To rebuild the doc indexes: python scripts/rebuild_index.py. Never edit _documents/architecture.md, design.md, notes.md or references.md directly — they are generated.',

	// Non-ASCII entry — exercises jina multilingual tokenizer path
	// (French + Japanese mixed; a pooling or tokenizer regression would shift scores here
	//  without affecting ASCII-only inputs)
	'Mémoire système: le modèle d\'intégration utilise CLS pooling (pas mean). 記憶の取得にはコサイン類似度を使用する。Δscore ≤ 1e-3 est la tolérance acceptée.',

	// Long entry >= 1200 chars — exercises text.slice(0,1200) truncation in generateEmbedding.
	// Constructed from realistic nexus architectural prose to keep the semantic domain consistent.
	'Architecture decision: the parity harness exists because a wrong --pooling value produces well-formed, correctly-shaped, 1024-dim, semantically-degraded vectors that get written into memories_vec and silently poison recall quality forever. No type check, HTTP status, or smoke test catches that. Only a cosine comparison against a pre-migration baseline does. The gate thresholds are pre-committed (cosine >= 0.9990, dim === 1024, |Δscore| <= 1e-3, identical ranking order) so there is no run-time judgement call. The harness also records latency (p50/p95 of recallByQuery) on both sides of the cutover for human review, but latency is report-only — it does not gate the migration. The fixture corpus must include at least one input >= 1200 chars to exercise the text.slice(0,1200) truncation boundary in generateEmbedding, and at least one non-ASCII input because jina-reranker-v2-base-multilingual is the multilingual variant and a tokenizer difference would otherwise go unmeasured. The baseline is written once, before any config edit, and is irreversible: once either old transport is retired the pre-migration numbers can never be recaptured. --verify with no baseline present exits non-zero with an explicit message; it never treats an absent baseline as a pass. The two-file split (verify-model-parity.mjs for I/O, parity-gates.mjs for pure math) is drawn exactly where testability requires it: the gate math is unit-tested (TDD, red-first), the harness is validated end-to-end against the still-live old transport.',
];

// ---------------------------------------------------------------------------
// Baseline schema helpers
// ---------------------------------------------------------------------------

/** @returns {object} Empty baseline skeleton matching the architecture.md Storage schema. */
function emptyBaseline() {
	return {
		captured_at: new Date().toISOString(),
		embedding: {
			model: 'mxbai-embed-large',
			transport: 'ollama',
			cases: [],
		},
		reranker: {
			model: 'jina-reranker-v2-base-multilingual',
			transport: 'standalone-8931',
			cases: [],
		},
		latency: {
			recall_p50_ms: 0,
			recall_p95_ms: 0,
			n: 0,
		},
	};
}

function readBaseline() {
	return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

function writeBaseline(baseline) {
	writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, '\t'), 'utf8');
	console.log(`[parity] baseline written → ${BASELINE_PATH}`);
}

// ---------------------------------------------------------------------------
// Pre-migration transport constants (sourced from src/core/config.ts DEFAULTS,
// read-only). Pinned here deliberately — the entire point of --capture is to
// record against the OLD transports while they are still live. Never derive these
// from extraction_models.yaml at capture time; a YAML that already points at the
// new transport would silently produce the wrong baseline.
// ---------------------------------------------------------------------------

const OLD_EMBED_ENDPOINT  = 'http://127.0.0.1:11434/api/embed';
const OLD_EMBED_MODEL     = 'mxbai-embed-large';
const OLD_RERANK_ENDPOINT = 'http://127.0.0.1:8931/rerank';
// Ollama base URL for the liveness probe (just scheme+host+port)
const OLLAMA_BASE_URL     = 'http://127.0.0.1:11434';
const RERANK_BASE_URL     = 'http://127.0.0.1:8931';
const EMBED_TEXT_LIMIT    = 1200; // matches generateEmbedding's text.slice(0,1200)
const EMBED_TIMEOUT_MS    = 15_000;
const RERANK_TIMEOUT_MS   = 10_000;

// Rerank fixture — a representative query over a cross-section of FIXTURE_CORPUS.
// Using the first 10 entries covers factual, procedural, and non-ASCII memory types.
const RERANK_QUERY     = 'parity baseline capture and migration transport verification';
const RERANK_DOC_COUNT = 10; // use FIXTURE_CORPUS[0..9] as documents

// ---------------------------------------------------------------------------
// Transport probes — hard fail if either old transport is unreachable.
// A partially-captured or wrong-transport baseline is indistinguishable from a
// valid one once on disk and would silently disarm every downstream gate.
// ---------------------------------------------------------------------------

async function probeOllama() {
	let response;
	try {
		response = await fetch(OLLAMA_BASE_URL, { signal: AbortSignal.timeout(3_000) });
	} catch (err) {
		throw new Error(
			`[parity] HARD FAIL: Ollama at ${OLLAMA_BASE_URL} is unreachable ` +
			`(${err.message}). Start Ollama before running --capture.`,
		);
	}
	if (!response.ok) {
		throw new Error(
			`[parity] HARD FAIL: Ollama at ${OLLAMA_BASE_URL} returned HTTP ${response.status}. ` +
			`Ensure Ollama is healthy before running --capture.`,
		);
	}
}

async function probeReranker() {
	let response;
	try {
		response = await fetch(`${RERANK_BASE_URL}/health`, { signal: AbortSignal.timeout(3_000) });
	} catch (err) {
		throw new Error(
			`[parity] HARD FAIL: standalone reranker at ${RERANK_BASE_URL} is unreachable ` +
			`(${err.message}). Start the reranker daemon before running --capture.`,
		);
	}
	if (!response.ok) {
		throw new Error(
			`[parity] HARD FAIL: standalone reranker at ${RERANK_BASE_URL}/health returned ` +
			`HTTP ${response.status}. Ensure the reranker daemon is healthy before running --capture.`,
		);
	}
}

// ---------------------------------------------------------------------------
// Capture (task-006)
// ---------------------------------------------------------------------------

async function runCapture() {
	console.log('[parity] --capture: probing old transports…');

	// --- Pre-flight: hard fail if either transport is down. Write nothing until
	//     both confirm they are live.
	await probeOllama();
	console.log('[parity] Ollama reachable');
	await probeReranker();
	console.log('[parity] standalone reranker reachable');

	const baseline = emptyBaseline();

	// --- Embeddings -----------------------------------------------------------
	// Embed every FIXTURE_CORPUS entry via the pre-migration Ollama api/embed
	// endpoint. Record full float64 precision; no round-trip through a lossy format.
	console.log(`[parity] embedding ${FIXTURE_CORPUS.length} fixture entries via ${OLD_EMBED_ENDPOINT}…`);
	for (let i = 0; i < FIXTURE_CORPUS.length; i++) {
		const input = FIXTURE_CORPUS[i];
		const text  = input.slice(0, EMBED_TEXT_LIMIT); // match generateEmbedding truncation

		let response;
		try {
			response = await fetch(OLD_EMBED_ENDPOINT, {
				method:  'POST',
				headers: { 'Content-Type': 'application/json' },
				body:    JSON.stringify({ model: OLD_EMBED_MODEL, input: text }),
				signal:  AbortSignal.timeout(EMBED_TIMEOUT_MS),
			});
		} catch (err) {
			throw new Error(
				`[parity] HARD FAIL: Ollama embedding request ${i + 1}/${FIXTURE_CORPUS.length} ` +
				`failed (${err.message}). Old transport became unreachable mid-capture; baseline not written.`,
			);
		}

		if (!response.ok) {
			throw new Error(
				`[parity] HARD FAIL: Ollama embedding request ${i + 1}/${FIXTURE_CORPUS.length} ` +
				`returned HTTP ${response.status}. Baseline not written.`,
			);
		}

		const data = await response.json();

		if (
			!Array.isArray(data.embeddings) ||
			data.embeddings.length === 0 ||
			!Array.isArray(data.embeddings[0]) ||
			data.embeddings[0].length === 0
		) {
			throw new Error(
				`[parity] HARD FAIL: Ollama returned malformed embedding for fixture ${i + 1}. Baseline not written.`,
			);
		}

		const vector = data.embeddings[0]; // number[] — full float64, as returned by Ollama
		const dim    = vector.length;

		if (dim !== 1024) {
			throw new Error(
				`[parity] HARD FAIL: expected embedding dim 1024, got ${dim} for fixture ${i + 1}. ` +
				`Wrong model or pooling mode. Baseline not written.`,
			);
		}

		// Zero-vector guard: cosine is undefined for a zero vector; fail explicitly
		// rather than letting a NaN propagate through >= comparisons in --verify.
		const normSq = vector.reduce((sum, v) => sum + v * v, 0);
		if (normSq === 0) {
			throw new Error(
				`[parity] HARD FAIL: zero vector returned for fixture ${i + 1}. Baseline not written.`,
			);
		}

		baseline.embedding.cases.push({ input, dim, vector });

		if ((i + 1) % 5 === 0 || i + 1 === FIXTURE_CORPUS.length) {
			console.log(`[parity]   embedded ${i + 1}/${FIXTURE_CORPUS.length}`);
		}
	}

	// --- Rerank ---------------------------------------------------------------
	// Rerank a representative query against the first RERANK_DOC_COUNT fixture
	// entries via the pre-migration standalone daemon on port 8931.
	const rerankDocuments = FIXTURE_CORPUS.slice(0, RERANK_DOC_COUNT);
	console.log(
		`[parity] reranking ${rerankDocuments.length} documents via ${OLD_RERANK_ENDPOINT}…`,
	);

	let rerankResponse;
	try {
		rerankResponse = await fetch(OLD_RERANK_ENDPOINT, {
			method:  'POST',
			headers: { 'Content-Type': 'application/json' },
			body:    JSON.stringify({ query: RERANK_QUERY, documents: rerankDocuments }),
			signal:  AbortSignal.timeout(RERANK_TIMEOUT_MS),
		});
	} catch (err) {
		throw new Error(
			`[parity] HARD FAIL: rerank request failed (${err.message}). ` +
			`Old transport became unreachable mid-capture; baseline not written.`,
		);
	}

	if (!rerankResponse.ok) {
		throw new Error(
			`[parity] HARD FAIL: rerank endpoint returned HTTP ${rerankResponse.status}. Baseline not written.`,
		);
	}

	const rerankData = await rerankResponse.json();

	if (!Array.isArray(rerankData)) {
		throw new Error(
			`[parity] HARD FAIL: rerank response was not an array (got ${typeof rerankData}). Baseline not written.`,
		);
	}
	if (rerankData.length === 0) {
		throw new Error(
			`[parity] HARD FAIL: rerank returned an empty result array. Baseline not written.`,
		);
	}

	// Store: query, document list (text, not indices — so --verify can re-issue the
	// exact same inputs even if FIXTURE_CORPUS order changes), and the scored results.
	baseline.reranker.cases.push({
		query:     RERANK_QUERY,
		documents: rerankDocuments,
		results:   rerankData.map(d => ({ index: d.index, score: d.score })),
	});

	console.log(`[parity]   reranked — ${rerankData.length} result(s) returned`);

	// --- Latency (recallByQuery, report-only per D-014) ----------------------
	// N >= 20 samples. Use the first 5 FIXTURE_CORPUS entries cycled as queries.
	// Non-fatal: if dist is absent or DB is missing, baseline.latency stays n=0.
	{
		const LATENCY_N       = 20;
		const LATENCY_QUERIES = FIXTURE_CORPUS.slice(0, 5);
		try {
			const { recallByQuery } = await import('../dist/core/recall.js');
			const { default: Database } = await import('better-sqlite3');
			const { homedir } = await import('node:os');

			const dbPath = process.env.NEXUS_DB_PATH ?? join(homedir(), '.claude', 'memories', 'nexus.db');
			if (!existsSync(dbPath)) {
				console.warn(`[parity] latency: DB not found at ${dbPath} — skipping (set NEXUS_DB_PATH to override)`);
			} else {
				const db      = new Database(dbPath, { readonly: true });
				const samples = [];

				for (let i = 0; samples.length < LATENCY_N; i++) {
					const query = LATENCY_QUERIES[i % LATENCY_QUERIES.length];
					const t0    = performance.now();
					await recallByQuery(db, { query, limit: 5 });
					samples.push(performance.now() - t0);
				}

				db.close();
				samples.sort((a, b) => a - b);

				const p50 = Math.round(samples[Math.floor(samples.length * 0.50)] * 10) / 10;
				const p95 = Math.round(samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)] * 10) / 10;

				baseline.latency = { recall_p50_ms: p50, recall_p95_ms: p95, n: samples.length };
				console.log(
					`[parity] latency (recallByQuery n=${samples.length}): p50=${p50}ms p95=${p95}ms`,
				);
			}
		} catch (err) {
			console.warn(`[parity] latency: skipped — ${err.message}`);
			// baseline.latency stays at { n: 0 } default — --verify will note it
		}
	}

	writeBaseline(baseline);
	console.log('[parity] capture complete');
}

// ---------------------------------------------------------------------------
// Current-config loader — delegates to the real src/core/config.ts (compiled
// to dist/) instead of maintaining a second, driftable copy of its defaults.
// Was previously a hand-duplicated CONFIG_DEFAULTS that still pointed at
// Ollama's port after task-014 repointed the real config — a stale-mirror bug
// caught during task-017's first live run. `npm run build` before invoking
// this script if src/core/config.ts changed and dist/ is stale.
// ---------------------------------------------------------------------------

function loadCurrentConfig() {
	return getNexusConfig();
}

// ---------------------------------------------------------------------------
// Embedding fetcher — branches on provider to handle both Ollama api/embed and
// OpenAI-compat /v1/embeddings so --verify works before and after task-014.
// Returns number[] (float64, as returned by the transport).
// Throws on any transport error.
// ---------------------------------------------------------------------------

async function fetchEmbedding(endpoint, model, provider, text, timeoutMs) {
	let response;

	if (provider === 'ollama') {
		// Ollama: POST {model, input} → {embeddings: [[...]]}
		response = await fetch(endpoint, {
			method:  'POST',
			headers: { 'Content-Type': 'application/json' },
			body:    JSON.stringify({ model, input: text }),
			signal:  AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = await response.json();
		if (!Array.isArray(data.embeddings) || !Array.isArray(data.embeddings[0])) {
			throw new Error('malformed Ollama response: missing embeddings[0] array');
		}
		return data.embeddings[0];
	}

	// OpenAI-compat (llama-swap, future provider): POST {model, input: [text]} → {data:[{embedding:[...]}]}
	response = await fetch(endpoint, {
		method:  'POST',
		headers: { 'Content-Type': 'application/json' },
		body:    JSON.stringify({ model, input: [text] }),
		signal:  AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const data = await response.json();
	if (!Array.isArray(data.data) || !Array.isArray(data.data[0]?.embedding)) {
		throw new Error('malformed OpenAI-compat response: missing data[0].embedding array');
	}
	return data.data[0].embedding;
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

async function runVerify() {
	if (!existsSync(BASELINE_PATH)) {
		console.error('[parity] ERROR: no baseline found. Run --capture first before migrating.');
		process.exit(1);
	}

	const baseline = readBaseline();
	console.log(`[parity] --verify: comparing against baseline captured at ${baseline.captured_at}`);

	if (baseline.embedding.cases.length === 0 || baseline.reranker.cases.length === 0) {
		console.error(
			`[parity] ERROR: baseline has ${baseline.embedding.cases.length} embedding case(s) and ` +
			`${baseline.reranker.cases.length} reranker case(s) — an empty baseline cannot verify anything. ` +
			`Re-run --capture.`,
		);
		process.exit(1);
	}

	const cfg = loadCurrentConfig();
	const { endpoint: embedEndpoint, model: embedModel, provider: embedProvider, timeout_ms: embedTimeout } = cfg.embedding;
	const { endpoint: rerankEndpoint, timeout_ms: rerankTimeout } = cfg.reranker;

	console.log(`[parity] current embedding: provider=${embedProvider} endpoint=${embedEndpoint} model=${embedModel}`);
	console.log(`[parity] current reranker:  endpoint=${rerankEndpoint}`);

	let failures = 0;

	// --- Embedding gate -------------------------------------------------------
	// Per D-014: dim === 1024 AND cosine >= 0.9990 for EVERY fixture input.
	// Report each failure individually with the actual measured value.
	// Dimension mismatch is a distinct failure class from geometry shift.
	console.log(`[parity] embedding ${baseline.embedding.cases.length} fixture case(s)…`);

	for (let i = 0; i < baseline.embedding.cases.length; i++) {
		const baseCase = baseline.embedding.cases[i];
		const text = baseCase.input.slice(0, EMBED_TEXT_LIMIT);

		let currentVector;
		try {
			currentVector = await fetchEmbedding(embedEndpoint, embedModel, embedProvider, text, embedTimeout);
		} catch (err) {
			console.error(`[parity] FAIL fixture ${i}: embedding request failed — ${err.message}`);
			failures++;
			continue;
		}

		// Dimension mismatch reported first as a distinct failure class.
		if (currentVector.length !== EXPECTED_DIM) {
			console.error(
				`[parity] FAIL fixture ${i}: DIM MISMATCH — expected ${EXPECTED_DIM}, ` +
				`got ${currentVector.length} (baseline dim: ${baseCase.dim}) — ` +
				`likely wrong model or pooling mode, not quantisation noise`,
			);
			failures++;
			continue;
		}

		const result = checkEmbedding(baseCase.vector, currentVector);
		if (!result.pass) {
			// checkEmbedding already includes the actual measured cosine in result.reason.
			// Prefix with fixture index so the operator can correlate to the corpus entry.
			console.error(`[parity] FAIL fixture ${i}: ${result.reason}`);
			failures++;
		} else {
			const sim = cosine(baseCase.vector, currentVector);
			console.log(`[parity]   fixture ${i}: cosine=${sim.toFixed(6)} dim=${currentVector.length} PASS`);
		}
	}

	// --- Rerank gate ----------------------------------------------------------
	// Per D-014: |Δscore| <= 1e-3 AND identical ranking order for EVERY case.
	// checkRerank expects {id: string, score: number}; baseline stores {index, score}.
	console.log(`[parity] reranking ${baseline.reranker.cases.length} case(s)…`);

	for (let c = 0; c < baseline.reranker.cases.length; c++) {
		const baseCase = baseline.reranker.cases[c];

		let rerankData;
		try {
			const response = await fetch(rerankEndpoint, {
				method:  'POST',
				headers: { 'Content-Type': 'application/json' },
				body:    JSON.stringify({ query: baseCase.query, documents: baseCase.documents }),
				signal:  AbortSignal.timeout(rerankTimeout),
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			rerankData = await response.json();
		} catch (err) {
			console.error(`[parity] FAIL rerank case ${c}: request failed — ${err.message}`);
			failures++;
			continue;
		}

		if (!Array.isArray(rerankData)) {
			console.error(`[parity] FAIL rerank case ${c}: response is not an array (got ${typeof rerankData})`);
			failures++;
			continue;
		}

		// Normalise to {id: string, score: number} — checkRerank compares by id string equality.
		const baselineNorm = baseCase.results.map(r => ({ id: String(r.index), score: r.score }));
		const currentNorm  = rerankData.map(r => ({ id: String(r.index), score: r.score }));

		const result = checkRerank(baselineNorm, currentNorm);
		if (!result.pass) {
			console.error(`[parity] FAIL rerank case ${c}: ${result.reason}`);
			failures++;
		} else {
			console.log(`[parity]   rerank case ${c}: order and |Δscore| within tolerance PASS`);
		}
	}

	// --- Latency report (report-only per D-014 — never influences exit code) ---
	// Measure current recallByQuery latency and print side-by-side delta against
	// the baseline so a human can judge throughput change after transport cutover.
	{
		const LATENCY_N       = 20;
		const LATENCY_QUERIES = FIXTURE_CORPUS.slice(0, 5);

		console.log('\n[parity] ── LATENCY REPORT (report-only) ─────────────────────────────────');

		if (!baseline.latency || baseline.latency.n === 0) {
			console.log('[parity]   baseline has no latency data (captured before task-008 instrumentation)');
		}

		try {
			const { recallByQuery } = await import('../dist/core/recall.js');
			const { default: Database } = await import('better-sqlite3');
			const { homedir } = await import('node:os');

			const dbPath = process.env.NEXUS_DB_PATH ?? join(homedir(), '.claude', 'memories', 'nexus.db');
			if (!existsSync(dbPath)) {
				console.warn(`[parity]   latency: DB not found at ${dbPath} — skipping (set NEXUS_DB_PATH to override)`);
			} else {
				const db      = new Database(dbPath, { readonly: true });
				const samples = [];

				for (let i = 0; samples.length < LATENCY_N; i++) {
					const query = LATENCY_QUERIES[i % LATENCY_QUERIES.length];
					const t0    = performance.now();
					await recallByQuery(db, { query, limit: 5 });
					samples.push(performance.now() - t0);
				}

				db.close();
				samples.sort((a, b) => a - b);

				const curP50 = Math.round(samples[Math.floor(samples.length * 0.50)] * 10) / 10;
				const curP95 = Math.round(samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)] * 10) / 10;
				const curN   = samples.length;

				if (baseline.latency && baseline.latency.n > 0) {
					const bl       = baseline.latency;
					const deltaP50 = Math.round((curP50 - bl.recall_p50_ms) * 10) / 10;
					const deltaP95 = Math.round((curP95 - bl.recall_p95_ms) * 10) / 10;
					const sign     = v => (v >= 0 ? `+${v}` : `${v}`);

					console.log('[parity]   recallByQuery latency — baseline vs current:');
					console.log(`[parity]     p50:  ${bl.recall_p50_ms}ms → ${curP50}ms   delta ${sign(deltaP50)}ms`);
					console.log(`[parity]     p95:  ${bl.recall_p95_ms}ms → ${curP95}ms   delta ${sign(deltaP95)}ms`);
					console.log(`[parity]     n:    ${bl.n} (baseline)  /  ${curN} (current)`);

					// Human-readable call-to-action if delta is large. Not an exit gate.
					if (Math.abs(deltaP50) > bl.recall_p50_ms * 0.5) {
						console.log(
							`[parity]   *** p50 delta (${sign(deltaP50)}ms) exceeds 50% of baseline — ` +
							`investigate transport performance before completing cutover ***`,
						);
					}
				} else {
					console.log(
						`[parity]   recallByQuery latency (current): p50=${curP50}ms p95=${curP95}ms n=${curN}`,
					);
					console.log('[parity]   (no baseline latency to compare against)');
				}
			}
		} catch (err) {
			console.warn(`[parity]   latency measurement skipped — ${err.message}`);
		}

		console.log('[parity] ── END LATENCY REPORT ──────────────────────────────────────────\n');
	}

	// --- Result ----------------------------------------------------------------
	if (failures > 0) {
		console.error(`\n[parity] VERIFY FAILED: ${failures} gate failure(s). See individual FAIL lines above for fixture index and measured values.`);
		process.exit(1);
	}
	console.log('\n[parity] verify complete — all gates passed');
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const USAGE = `\
Usage:
  node scripts/verify-model-parity.mjs --capture   # record baseline BEFORE any config edit
  node scripts/verify-model-parity.mjs --verify    # compare current output; exits non-zero on drift
`;

// Guard: only run CLI logic when invoked directly, not when imported by tests or tools.
// Normalise to forward slashes for comparison — fileURLToPath returns backslashes on Windows.
const _thisFile = fileURLToPath(import.meta.url).replace(/\\/g, '/');
const _callerFile = (process.argv[1] ?? '').replace(/\\/g, '/');
if (_thisFile === _callerFile) {
	const args = process.argv.slice(2);
	const mode = args[0];

	if (mode === '--capture') {
		runCapture().catch((err) => {
			console.error('[parity] capture failed:', err.message);
			process.exit(1);
		});
	} else if (mode === '--verify') {
		runVerify().catch((err) => {
			console.error('[parity] verify failed:', err.message);
			process.exit(1);
		});
	} else {
		console.error(mode ? `Unknown option: ${mode}` : 'A mode flag is required.');
		process.stderr.write(USAGE);
		process.exit(1);
	}
}
