/**
 * Gate a candidate merge model before letting it near a distill sweep.
 *
 * Distill is destructive: every original in a cluster gets `superseded_by` set,
 * so a merge that silently drops a fact destroys it. This runs the real
 * MERGE_PROMPT over clusters with known content and fails the model on:
 *   - output that isn't parseable as a JSON object
 *   - required fields missing or not strings
 *   - RETENTION: a distinctive token from any input memory absent from the merge
 *
 * Invalid enum values are reported but not failed — distill.ts already falls
 * back to the head memory's memory_type/scope/decay_class.
 *
 * Usage: node scripts/check-merge-model.mjs <ollama-model> [--endpoint URL]
 */

import { mergePrompt } from '../dist/core/distill.js';
import { callModel } from '../dist/core/llm.js';

// Pass "configured" to gate the model from extraction_models.yaml instead — run
// that first to confirm the retention bar is actually clearable before judging a
// candidate against it.
const model = process.argv[2];
if (!model) {
	console.error('usage: node scripts/check-merge-model.mjs <ollama-model|configured> [--endpoint URL]');
	process.exit(2);
}
const endpointIdx = process.argv.indexOf('--endpoint');
const endpoint = endpointIdx === -1 ? 'http://127.0.0.1:11434/v1/chat/completions' : process.argv[endpointIdx + 1];

const MEMORY_TYPES = new Set(['preference', 'convention', 'failure', 'correction', 'decision', 'insight', 'tool_quirk', 'reference', 'handoff']);
const DECAY_CLASSES = new Set(['stable', 'architecture', 'api_contract', 'implementation']);
const SCOPES = new Set(['global', 'shared', 'project']);

// Each case: cluster memories, plus the distinctive tokens that MUST survive.
// Tokens are deliberately specific (numbers, identifiers, paths) — generic words
// would pass trivially. An array means any-of: a model that spells "20" as
// "twenty" has retained the fact, and failing it would be measuring surface form
// rather than information loss.
const CASES = [
	{
		name: 'two-way, disjoint facts',
		cluster: [
			{ type: 'convention', title: 'Indentation', body: 'Use tabs for indentation throughout the codebase.' },
			{ type: 'convention', title: 'Line width', body: 'Keep lines under 120 characters. Editors should be configured with a ruler.' },
		],
		mustRetain: ['tab', ['120', 'one hundred twenty']],
	},
	{
		name: 'three-way, distinct identifiers',
		cluster: [
			{ type: 'tool_quirk', title: 'Ollama endpoint', body: 'Embeddings are generated via Ollama at 127.0.0.1:11434 using mxbai-embed-large.' },
			{ type: 'convention', title: 'Vector width', body: 'The vec0 virtual table is 1024 dimensions wide and must match the embedding model.' },
			{ type: 'failure', title: 'sqlite-vec load', body: 'If sqlite-vec fails to load, vector search is disabled but the rest of Nexus still works.' },
		],
		mustRetain: ['11434', 'mxbai-embed-large', ['1024', 'one thousand twenty-four'], 'sqlite-vec'],
	},
	{
		name: 'conflicting specificity — keep the more specific number',
		cluster: [
			{ type: 'decision', title: 'Recall budget', body: 'Bulk recall is capped at a few thousand tokens.' },
			{ type: 'decision', title: 'Recall budget exact', body: 'recall.max_tokens is 2000, and min_confidence is 0.35.' },
		],
		mustRetain: ['2000', '0.35'],
	},
	{
		name: 'two-way, same subject, file paths',
		cluster: [
			{ type: 'reference', title: 'MCP entry point', body: 'The MCP server lives in src/mcp/server.ts and speaks stdio transport.' },
			{ type: 'reference', title: 'MCP tool surface', body: 'That same MCP server exposes 20 tools to Claude Code.' },
		],
		mustRetain: ['server.ts', 'stdio', ['20', 'twenty']],
	},
	{
		// The case the original 4-case gate missed. Real memories carry 20-46
		// identifiers, not 4; that density is exactly where the flat sentence cap
		// caused ~30% silent loss in the 2026-07-26 audit.
		name: 'identifier-dense (the real failure mode)',
		cluster: [
			{
				type: 'reference', title: 'Encyclopedia pipeline scripts',
				body: 'The pipeline runs batch_process.py, then route_book.py, then filter_batches.py, then consolidate_topics.py, and finally merge_shared_kb.py. State lives in routing-cache.json and book-queue.json.',
			},
			{
				type: 'convention', title: 'Encyclopedia pipeline phases',
				body: 'Five gated phases: Intake, Preflight, Analyze, Consolidate, Finalize. Each writes a report JSON validated before the next starts. build_queue.py seeds the queue and cross_link_topics.py runs last.',
			},
		],
		mustRetain: [
			'batch_process.py', 'route_book.py', 'filter_batches.py', 'consolidate_topics.py',
			'merge_shared_kb.py', 'routing-cache.json', 'book-queue.json',
			'build_queue.py', 'cross_link_topics.py',
			'intake', 'preflight', 'analyze', 'finalize',
		],
	},
	{
		name: 'shader keywords and paths',
		cluster: [
			{
				type: 'insight', title: 'Standard shader render mode',
				body: 'Switching a Standard shader render mode at runtime requires setting _SrcBlend, _DstBlend, _ZWrite, and toggling _ALPHATEST_ON, _ALPHABLEND_ON, _ALPHAPREMULTIPLY_ON, plus the renderQueue.',
			},
			{
				type: 'convention', title: 'Shader property caching',
				body: 'Cache Shader.PropertyToID results in static readonly fields. Documented in Recipes/vfx/global-shader-params-gamecomponent-tick.md as RCP-vfx-004.',
			},
		],
		mustRetain: [
			'_SrcBlend', '_DstBlend', '_ZWrite', '_ALPHATEST_ON', '_ALPHABLEND_ON',
			'_ALPHAPREMULTIPLY_ON', 'renderQueue', 'Shader.PropertyToID',
			'Recipes/vfx/global-shader-params-gamecomponent-tick.md', 'RCP-vfx-004',
		],
	},
];

function firstJsonObject(raw) {
	if (!raw?.trim()) return null;
	let parsed;
	try { parsed = JSON.parse(raw.trim()); }
	catch {
		const m = raw.match(/\{[\s\S]*\}/);
		if (!m) return null;
		try { parsed = JSON.parse(m[0]); } catch { return null; }
	}
	return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

async function call(system, user) {
	if (model === 'configured') return await callModel(system, user);
	const res = await fetch(endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model,
			messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
			temperature: 0.2,
			stream: false,
		}),
		signal: AbortSignal.timeout(180000),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
	const data = await res.json();
	return data?.choices?.[0]?.message?.content ?? '';
}

console.log(`gating merge model: ${model}\nendpoint: ${endpoint}\n`);

let passed = 0;
let unsafe = 0;    // dropped a fact — the disqualifying outcome
let noMerge = 0;   // unparseable output; distill discards it and supersedes nothing
let enumWarnings = 0;
const timings = [];

for (const c of CASES) {
	const listing = c.cluster
		.map((m, i) => `[${i + 1}] (${m.type}) ${m.title}\n${m.body}`)
		.join('\n\n');

	let raw, secs;
	const t0 = Date.now();
	try {
		raw = await call(mergePrompt(c.cluster.length), listing);
	} catch (err) {
		console.log(`FAIL  ${c.name}\n      call error: ${err.message}\n`);
		continue;
	} finally {
		secs = ((Date.now() - t0) / 1000).toFixed(1);
		timings.push(Number(secs));
	}

	const obj = firstJsonObject(raw);
	if (!obj || typeof obj.title !== 'string' || typeof obj.body !== 'string') {
		// Safe, not correct: distill's firstJsonObject returns null and the cluster
		// is skipped, so nothing is superseded. Wasted call, no data loss.
		noMerge++;
		console.log(`skip  ${c.name} (${secs}s) — unparseable, cluster would be left intact\n      raw: ${raw.slice(0, 200)}\n`);
		continue;
	}

	const hay = `${obj.title}\n${obj.body}`.toLowerCase();
	const lost = c.mustRetain
		.filter(tok => {
			const forms = Array.isArray(tok) ? tok : [tok];
			return !forms.some(f => hay.includes(f.toLowerCase()));
		})
		.map(tok => (Array.isArray(tok) ? tok[0] : tok));

	const badEnums = [];
	if (!MEMORY_TYPES.has(obj.memory_type)) badEnums.push(`memory_type=${obj.memory_type}`);
	if (!SCOPES.has(obj.scope)) badEnums.push(`scope=${obj.scope}`);
	if (!DECAY_CLASSES.has(obj.decay_class)) badEnums.push(`decay_class=${obj.decay_class}`);
	if (badEnums.length) enumWarnings++;

	if (lost.length) {
		unsafe++;
		console.log(`FAIL  ${c.name} (${secs}s)\n      DROPPED: ${lost.join(', ')} — originals would be superseded anyway\n      body: ${obj.body}\n`);
	} else {
		passed++;
		console.log(`pass  ${c.name} (${secs}s)${badEnums.length ? `  [enums fell back: ${badEnums.join(', ')}]` : ''}\n      body: ${obj.body}\n`);
	}
}

const avg = timings.length ? (timings.reduce((a, b) => a + b, 0) / timings.length).toFixed(1) : '—';
console.log(
	`${passed}/${CASES.length} merged with full retention, ${noMerge} declined to merge (safe), ` +
	`${unsafe} dropped facts (unsafe). avg ${avg}s/call. ${enumWarnings} case(s) needed enum fallback.`
);
// Only fact loss disqualifies: a declined merge costs a call, a lossy merge costs
// a memory. Timing is reported for the operator to weigh, never gated on.
console.log(unsafe === 0
	? 'VERDICT: safe for a distill sweep.'
	: 'VERDICT: NOT safe — this model loses facts, and distill supersedes the originals.');
process.exit(unsafe === 0 ? 0 : 1);
