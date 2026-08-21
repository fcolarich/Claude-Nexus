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
/**
 * Extract deterministic, code-like identifiers from text. Pure function, pure
 * regex — no model call, no randomness. Returns a de-duplicated array, order
 * of first appearance.
 */
export declare function extractIdentifiers(text: string): string[];
/**
 * Set-union identifier lists in code. The only place identifiers are combined
 * across memories during consolidation — never inferred from a model's merged
 * prose. Case-sensitive: `ADR-019` and `adr-019` are kept distinct on purpose,
 * since case often carries meaning in identifiers (env vars vs. paths).
 */
export declare function unionIdentifiers(...lists: string[][]): string[];
//# sourceMappingURL=identifiers.d.ts.map