/**
 * llama-swap readiness module for nexus — shared by embedder and reranker.
 *
 * Replaces (deletes) two bespoke spawn helpers that used to live in
 * embeddings.ts and reranker.ts (Ollama-spawn and reranker-daemon-spawn).
 *
 * Structurally modelled on uber-db src/llama-swap-client.ts (read-only reference).
 * No cross-repo import; no shared package.
 *
 * Contract (D-007, D-008):
 *   - Two-tier readiness: GET /v1/models (pool liveness) → caller warmup (model warmth)
 *   - NEVER throws; resolves false on unrecoverable failure so callers null-degrade
 *   - Memo is PROMISE-valued so two concurrent first calls don't both spawn llama-swap
 *   - force:true bypasses memo entirely; mid-run TTL eviction then stays visible
 *   - Warmup fail → false (live proxy + dead model is not ready; returning true would
 *     convert a clean degrade into a per-call timeout storm)
 */

import { spawn } from 'child_process';
import { getNexusConfig } from './config.js';

// Short bound for liveness probes — we're checking health, not doing inference.
// Without this, a half-open socket hangs fetch() indefinitely (2026-07-20 incident
// in uber-db; same risk applies here).
const PING_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 1_000;

// Promise-valued memo: concurrent first calls share one promise instead of both
// spawning llama-swap.
const memo = new Map<string, Promise<boolean>>();

/** Return scheme+host+port of the llama-swap proxy, derived from embedding.endpoint. */
export function llamaSwapBase(): string {
	try {
		const u = new URL(getNexusConfig().embedding.endpoint);
		return `${u.protocol}//${u.host}`;
	} catch {
		return process.env['LLAMA_SWAP_BASE_URL'] ?? 'http://127.0.0.1:8091';
	}
}

/** host:port for llama-swap's -listen flag, derived from embedding.endpoint. */
function listenAddr(): string {
	try {
		const u = new URL(getNexusConfig().embedding.endpoint);
		return `${u.hostname}:${u.port || '8091'}`;
	} catch {
		return (process.env['LLAMA_SWAP_BASE_URL'] ?? '127.0.0.1:8091').replace(/^https?:\/\//, '');
	}
}

/**
 * Ensure the llama-swap proxy is up AND the named model is warm.
 *
 * Sequence:
 *   1. GET {base}/v1/models — pool liveness (loads nothing, works for OpenAI and
 *      non-OpenAI upstreams alike per D-007)
 *   2. If proxy absent: spawn llama-swap (detached, fire-and-forget) then poll
 *      /v1/models until budgetMs expires
 *   3. Call warmup() on the model's own route — proxy live ≠ model warm
 *   4. Return warmup result; resolve false if any unrecoverable step fails
 */
export async function ensureLlamaSwapReady(
	model: string,
	warmup: () => Promise<boolean>,
	opts?: { force?: boolean; budgetMs?: number },
): Promise<boolean> {
	const { force = false, budgetMs = 60_000 } = opts ?? {};

	if (!force && memo.has(model)) {
		return memo.get(model)!;
	}

	const promise = _doEnsure(model, warmup, budgetMs);
	// Store before await so any concurrent non-force call shares this promise.
	memo.set(model, promise);
	return promise;
}

async function _doEnsure(
	model: string,
	warmup: () => Promise<boolean>,
	budgetMs: number,
): Promise<boolean> {
	const base = llamaSwapBase();
	const deadline = Date.now() + budgetMs;

	// ── 1. Ping ───────────────────────────────────────────────────────────────
	let proxyUp = false;
	try {
		const res = await fetch(`${base}/v1/models`, {
			signal: AbortSignal.timeout(PING_TIMEOUT_MS),
		});
		proxyUp = res.ok;
	} catch {
		// Fall through to spawn + poll
	}

	// ── 2. Spawn + poll if absent ─────────────────────────────────────────────
	if (!proxyUp) {
		const cfg = getNexusConfig();
		const { executablePath, configPath } = cfg.llamaSwap;

		if (executablePath && configPath) {
			try {
				const proc = spawn(
					executablePath,
					['-config', configPath, '-listen', listenAddr()],
					{ detached: true, stdio: 'ignore', shell: false },
				);
				// spawn() with a missing binary emits an async 'error' event rather than
				// throwing; a no-op listener makes the failure non-fatal (see uber-db ref).
				proc.on('error', () => {});
				proc.unref();
			} catch {
				// Spawn failure is non-fatal; poll will time out and return false.
			}
		} else {
			console.warn('[llama-swap] executablePath/configPath not configured; cannot auto-start');
		}

		while (Date.now() < deadline) {
			await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
			try {
				const res = await fetch(`${base}/v1/models`, {
					signal: AbortSignal.timeout(PING_TIMEOUT_MS),
				});
				if (res.ok) { proxyUp = true; break; }
			} catch {
				// Still starting
			}
		}

		if (!proxyUp) {
			console.warn(`[llama-swap] proxy did not come up within budget (model: ${model}, base: ${base})`);
			return false;
		}
	}

	// ── 3. Warmup — proxy live ≠ model warm ──────────────────────────────────
	try {
		return await warmup();
	} catch {
		// warmup threw (network error, etc.) — treat as not ready
		return false;
	}
}
