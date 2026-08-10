/**
 * Claim extraction — decomposes one memory into atomic claims (Phase 2,
 * _documents/design-structured-memory.md, design worktree).
 *
 * NOT wired into the capture path (auto-distill-on-write is out of scope per
 * the design doc's stated scope exclusion). Run explicitly, on a measured
 * subset first — full-population decomposition is deferred pending that
 * validation (design doc, "Migration and backfill strategy").
 *
 * Extract-then-verify loop per DDR-20260808153651-39: deterministic checker
 * (code, not the model judging itself), missing identifiers enumerated as
 * data on retry (Chain-of-Density's working mechanism — arXiv:2309.04269),
 * max 2 retries, REJECT on final failure — never a partial write, sources
 * (the memory) stay untouched.
 *
 * Claim body authoring is generative (model call injected via `callFn`, same
 * pattern as distill.ts's mergePrompt — use whatever model distillation uses,
 * not necessarily Haiku; the design doc's "Haiku extraction" label names the
 * mechanism class, not a hard model requirement). claim_type is DERIVED from
 * the parent memory_type, never asked of the model; identifiers are extracted
 * deterministically per claim (src/core/identifiers.ts), never model-generated.
 * No response_format/constrained decoding (q-007 — corrupted 91 memories,
 * rejected).
 */

import type { MemoryType } from '../core/types.js';
import { insertClaim, type ClaimInput } from '../core/claims.js';
import { extractIdentifiers, unionIdentifiers } from '../core/identifiers.js';
import type Database from 'better-sqlite3';

const MAX_RETRIES = 2;

export const claimExtractPrompt = (missing?: string[]) => `You decompose a memory into atomic claims.

A claim is ONE verifiable, self-contained fact — semantically equivalent to a single sentence or predicate, carrying its subject, predicate, and value. It is NOT a sub-sentence subject-predicate-object triplet, and it is NOT the whole memory body. Write each claim so it stands alone with enough context to be understood without the others.

When two clauses are joined by a contrastive or causal connective — but, however, although, because, since, therefore, which means, at the cost of, in exchange for, unless — keep them together as ONE claim. The trade-off or cause-and-effect relationship IS the fact; splitting it loses the thing worth keeping. Example: "Planning offline requires full knowledge upfront but guarantees no wasted effort on wrong paths" is ONE claim, not two. Only split when clauses state genuinely independent, freestanding facts — separate items in a list, separate conditions, separate steps.
${missing?.length ? `\nYour previous attempt did not mention these identifiers anywhere in the claims: ${missing.join(', ')}. Revise so the claim set covers every one of them.\n` : ''}
Output STRICT JSON ONLY, an array of objects: [{"fact": "..."}]
No prose or fences outside the JSON.`;

/**
 * Identifiers present in the source text but absent from every generated
 * claim's own fact text. The deterministic checker driving the retry loop —
 * never the model judging itself.
 */
export function missingIdentifiers(sourceText: string, claimFacts: string[]): string[] {
	const sourceIds = extractIdentifiers(sourceText);
	const coveredIds = unionIdentifiers(...claimFacts.map((f) => extractIdentifiers(f)));
	return sourceIds.filter((id) => !coveredIds.includes(id));
}

function firstJsonArray(raw: string): unknown[] | null {
	if (!raw?.trim()) return null;
	let parsed: unknown;
	try { parsed = JSON.parse(raw.trim()); }
	catch {
		const m = raw.match(/\[[\s\S]*\]/);
		if (!m) return null;
		try { parsed = JSON.parse(m[0]); } catch { return null; }
	}
	return Array.isArray(parsed) ? parsed : null;
}

export interface ClaimExtractSourceMemory {
	id: string;
	body: string;
	memory_type: MemoryType;
	confidence: number;
}

export interface ClaimExtractResult {
	claims: { id: string; claim_type: MemoryType; fact: string }[];
	rejected: boolean;
}

/**
 * Extract claims for one memory, verify identifier coverage, retry with the
 * missing set named, and on final failure reject WITHOUT writing anything —
 * the memory (source) is never touched, per the design's never-supersede-
 * on-failed-verify constraint (mirrors distill.ts's coverage-gate rejection).
 */
export async function extractClaimsForMemory(
	db: Database.Database,
	memory: ClaimExtractSourceMemory,
	callFn: (system: string, user: string) => Promise<string>,
): Promise<ClaimExtractResult> {
	let facts: string[] = [];
	let missing: string[] = [];

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const raw = await callFn(claimExtractPrompt(attempt > 0 ? missing : undefined), memory.body);
		const arr = firstJsonArray(raw);
		if (!arr) return { claims: [], rejected: true };

		facts = arr
			.filter((item): item is { fact: string } => typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).fact === 'string')
			.map((item) => item.fact);
		if (facts.length === 0) return { claims: [], rejected: true };

		missing = missingIdentifiers(memory.body, facts);
		if (missing.length === 0) break;
		if (attempt === MAX_RETRIES) return { claims: [], rejected: true };
	}

	const inserted: { id: string; claim_type: MemoryType; fact: string }[] = [];
	for (const fact of facts) {
		const input: ClaimInput = {
			memory_id: memory.id,
			source_memory_id: memory.id,
			fact,
			claim_type: memory.memory_type,
			confidence: memory.confidence,
		};
		const { id } = insertClaim(db, input);
		inserted.push({ id, claim_type: memory.memory_type, fact });
	}

	return { claims: inserted, rejected: false };
}
