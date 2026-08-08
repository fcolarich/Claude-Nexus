/**
 * Secret-redaction guard for the capture path (FEAT-001).
 *
 * Zero project imports (D-011) — patterns and thresholds are module
 * constants here, nothing pulled from config.ts or extraction_models.yaml.
 */
export type RedactionMode = 'strict' | 'full';
export interface RedactionResult {
    text: string;
    redactions: string[];
}
/**
 * Row shape for SECRET_PATTERNS (populated in a later task). `group`, when
 * set, means only that capture group's span is replaced, not the whole match.
 */
export interface SecretPatternRow {
    kind: string;
    re: RegExp;
    modes: ReadonlyArray<RedactionMode>;
    group?: number;
    /** When set, a captured group value failing this predicate is left unredacted. */
    suppress?: (value: string) => boolean;
}
export declare const SECRET_PATTERNS: ReadonlyArray<SecretPatternRow>;
/** Formats the placeholder substituted for a redacted span. */
export declare function formatPlaceholder(kind: string): string;
/** Guards against re-matching an already-redacted placeholder span. */
export declare const PLACEHOLDER_RE: RegExp;
/**
 * Structural stand-in for extract.ts's MemoryCandidate — secrets.ts stays
 * dependency-free (D-011), so callers pass any object shaped like this
 * rather than this module importing the real interface.
 */
export interface MemoryCandidateLike {
    title: string;
    body: string;
    tags: string[];
}
/**
 * Scrubs a candidate's title, body and tags in 'full' mode (thin wrapper,
 * D-004). Returns a new object (spread from the input, never mutated) plus
 * the concatenated redaction kinds in field order (title, then body, then
 * tags). A tag that triggers any redaction is dropped, not
 * placeholder-substituted (D-010).
 *
 * The optional `redact` parameter is a deliberate extension of the
 * architecture interface: `reflect()` injects `deps.redact ?? redactSecrets`
 * so a single throwing double reaches both the pre-extraction gate and this
 * post-extraction gate (D-009).
 */
export declare function redactCandidate<T extends MemoryCandidateLike>(c: T, redact?: typeof redactSecrets): {
    candidate: T;
    redactions: string[];
};
/**
 * Shannon entropy of `token` in bits per character.
 *
 * Backstop for D-006 — a uniform 4-symbol alphabet is 2 bits/char, a pure
 * hex alphabet tops out under 4.0, real high-entropy tokens reach >= 4.5.
 */
export declare function shannonEntropy(token: string): number;
/**
 * Pure. Idempotent: redactSecrets(redactSecrets(t, m).text, m).text === redactSecrets(t, m).text.
 * Never throws — internal failure returns { text, redactions: [] } (fail open, D-002).
 *
 * Applies SECRET_PATTERNS in table order, one whole-text String.replace pass per
 * row, each pass consuming the previous pass's output. Rows are never passed to
 * .test()/.exec() — only replace/matchAll — to avoid the shared /g regex
 * lastIndex mutation hazard on module-level constants.
 */
export declare function redactSecrets(text: string, mode?: RedactionMode): RedactionResult;
//# sourceMappingURL=secrets.d.ts.map