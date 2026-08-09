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
 * Claim body authoring is generative (Haiku); claim_type is DERIVED from the
 * parent memory_type, never asked of the model; identifiers are extracted
 * deterministically per claim (src/core/identifiers.ts), never model-generated.
 * No response_format/constrained decoding (q-007 — corrupted 91 memories,
 * rejected).
 */
import { insertClaim } from '../core/claims.js';
import { extractIdentifiers, unionIdentifiers } from '../core/identifiers.js';
const MAX_RETRIES = 2;
export const claimExtractPrompt = (missing) => `You decompose a memory into atomic claims.

A claim is ONE verifiable, self-contained fact — semantically equivalent to a single sentence or predicate, carrying its subject, predicate, and value. It is NOT a sub-sentence subject-predicate-object triplet, and it is NOT the whole memory body. Write each claim so it stands alone with enough context to be understood without the others.
${missing?.length ? `\nYour previous attempt did not mention these identifiers anywhere in the claims: ${missing.join(', ')}. Revise so the claim set covers every one of them.\n` : ''}
Output STRICT JSON ONLY, an array of objects: [{"fact": "..."}]
No prose or fences outside the JSON.`;
/**
 * Identifiers present in the source text but absent from every generated
 * claim's own fact text. The deterministic checker driving the retry loop —
 * never the model judging itself.
 */
export function missingIdentifiers(sourceText, claimFacts) {
    const sourceIds = extractIdentifiers(sourceText);
    const coveredIds = unionIdentifiers(...claimFacts.map((f) => extractIdentifiers(f)));
    return sourceIds.filter((id) => !coveredIds.includes(id));
}
function firstJsonArray(raw) {
    if (!raw?.trim())
        return null;
    let parsed;
    try {
        parsed = JSON.parse(raw.trim());
    }
    catch {
        const m = raw.match(/\[[\s\S]*\]/);
        if (!m)
            return null;
        try {
            parsed = JSON.parse(m[0]);
        }
        catch {
            return null;
        }
    }
    return Array.isArray(parsed) ? parsed : null;
}
/**
 * Extract claims for one memory, verify identifier coverage, retry with the
 * missing set named, and on final failure reject WITHOUT writing anything —
 * the memory (source) is never touched, per the design's never-supersede-
 * on-failed-verify constraint (mirrors distill.ts's coverage-gate rejection).
 */
export async function extractClaimsForMemory(db, memory, callFn) {
    let facts = [];
    let missing = [];
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const raw = await callFn(claimExtractPrompt(attempt > 0 ? missing : undefined), memory.body);
        const arr = firstJsonArray(raw);
        if (!arr)
            return { claims: [], rejected: true };
        facts = arr
            .filter((item) => typeof item === 'object' && item !== null && typeof item.fact === 'string')
            .map((item) => item.fact);
        if (facts.length === 0)
            return { claims: [], rejected: true };
        missing = missingIdentifiers(memory.body, facts);
        if (missing.length === 0)
            break;
        if (attempt === MAX_RETRIES)
            return { claims: [], rejected: true };
    }
    const inserted = [];
    for (const fact of facts) {
        const input = {
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
//# sourceMappingURL=claim-extract.js.map