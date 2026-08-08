/**
 * Deterministic code-like identifier extraction — no LLM, ever.
 *
 * This is the Phase 1 mechanism from _documents/design-structured-memory.md: identifier
 * loss during consolidation becomes structurally impossible for every identifier this
 * extractor captures, because identifiers are stored in their own column and
 * set-unioned in code during merge — the model never touches them.
 *
 * Pattern set and filtering intentionally match scripts/audit-merges.mjs's --strict
 * distinctiveTokens(): that script is the validation harness for this exact guarantee,
 * so the definition of "identifier" here and the definition the harness checks against
 * must be the same definition, not two independently-maintained copies that can drift.
 *
 * Backticks alone are insufficient (measured 80% precision, 725 spans; only 23% of
 * memories use them at all — _documents/design-structured-memory.md), so this also
 * targets file paths, function/script names, config keys, CLI flags, CONST_NAMES and
 * numeric values by pattern, not by markup.
 */
const PATTERNS = [
    /`[^`]{2,60}`/g, // backticked spans
    /\b[A-Za-z_][A-Za-z0-9_]*(?:[._\/-][A-Za-z0-9_]+)+\b/g, // dotted / pathed / snake identifiers
    /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g, // CamelCase
    /\b[A-Z]{3,}(?:_[A-Z0-9]+)*\b/g, // ALLCAPS / CONST_NAMES
    /\b\d+\.\d+\b/g, // decimals (0.35, 4.5)
    /\b\d{2,}\b/g, // multi-digit numbers
];
// Punctuation-ish matches the identifier pattern catches but that carry no fact.
const NOISE = new Set(['e.g', 'e.g.', 'i.e', 'i.e.', 'etc', 'vs', 'ie', 'eg']);
// ALLCAPS emphasis in memory bodies ("do NOT", "source text ONLY"), not identifiers.
const EMPHASIS = new Set([
    'NOT', 'ONLY', 'ALL', 'ANY', 'AND', 'THE', 'MUST', 'NEVER', 'ALWAYS', 'BUT',
    'YES', 'NO', 'USE', 'DO', 'DONT', 'NOTE', 'WARNING', 'IMPORTANT', 'STRICT',
]);
/**
 * Extract deterministic, code-like identifiers from text. Pure function, pure
 * regex — no model call, no randomness. Returns a de-duplicated array, order
 * of first appearance.
 */
export function extractIdentifiers(text) {
    const out = new Set();
    if (!text)
        return [];
    for (const re of PATTERNS) {
        for (const m of Array.from(text.matchAll(re))) {
            // Strip backticks and wrapping quotes/punctuation: a body containing
            // `foo-bar` retains a source's `"foo-bar"` — that is not loss.
            const tok = m[0].replace(/`/g, '').replace(/^["'(\[{,.:;]+|["')\]},.:;]+$/g, '').trim();
            if (tok.length < 3)
                continue;
            if (NOISE.has(tok.toLowerCase()))
                continue;
            // Plain English words joined by - or / at any capitalisation
            // ("Mission-driven", "retention/recall"): reworadable prose, not an
            // identifier. A real identifier carries a dot, underscore, digit, or
            // internal capital (build_queue.py, RCP-vfx-004, book-queue.json).
            if (/^[A-Za-z]+(?:[-\/][A-Za-z]+)+$/.test(tok) && !/[._\d]/.test(tok) && !/[a-z][A-Z]/.test(tok))
                continue;
            if (EMPHASIS.has(tok.toUpperCase()) && tok === tok.toUpperCase())
                continue;
            out.add(tok);
        }
    }
    return Array.from(out);
}
/**
 * Set-union identifier lists in code. The only place identifiers are combined
 * across memories during consolidation — never inferred from a model's merged
 * prose. Case-sensitive: `ADR-019` and `adr-019` are kept distinct on purpose,
 * since case often carries meaning in identifiers (env vars vs. paths).
 */
export function unionIdentifiers(...lists) {
    const out = new Set();
    for (const list of lists)
        for (const id of list)
            out.add(id);
    return Array.from(out);
}
//# sourceMappingURL=identifiers.js.map