/**
 * Secret-redaction guard for the capture path (FEAT-001).
 *
 * Zero project imports (D-011) — patterns and thresholds are module
 * constants here, nothing pulled from config.ts or extraction_models.yaml.
 */
// Strict rows: named high-confidence credential formats, checked pre-extraction
// (gate 1). Full-mode-only rows (jwt, connection_string_password, assigned_secret,
// high_entropy) are added in a later task. Table order matters — private_key_block
// runs first so a PEM body is never chewed up token-by-token by a later row.
export const SECRET_PATTERNS = [
    {
        // Accepted limitation (D-004): an unterminated BEGIN block (no matching
        // END) does not match this pattern and is left unredacted — there is no
        // redact-to-end-of-text fallback for a truncated/malformed PEM body.
        kind: 'private_key_block',
        re: /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g,
        modes: ['strict', 'full'],
    },
    {
        kind: 'aws_access_key',
        re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA|ACCA)[A-Z0-9]{16}\b/g,
        modes: ['strict', 'full'],
    },
    {
        kind: 'github_token',
        re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b/g,
        modes: ['strict', 'full'],
    },
    {
        kind: 'github_pat',
        re: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g,
        modes: ['strict', 'full'],
    },
    {
        kind: 'slack_token',
        re: /\bxox[baprse]-[A-Za-z0-9-]{10,}\b/g,
        modes: ['strict', 'full'],
    },
    {
        kind: 'slack_webhook',
        re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}/g,
        modes: ['strict', 'full'],
    },
    {
        kind: 'stripe_key',
        re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
        modes: ['strict', 'full'],
    },
    {
        kind: 'anthropic_key',
        re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
        modes: ['strict', 'full'],
    },
    {
        kind: 'openai_key',
        re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
        modes: ['strict', 'full'],
    },
    {
        kind: 'google_api_key',
        re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
        modes: ['strict', 'full'],
    },
    {
        kind: 'npm_token',
        re: /\bnpm_[A-Za-z0-9]{36}\b/g,
        modes: ['strict', 'full'],
    },
    {
        kind: 'jwt',
        re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
        modes: ['full'],
    },
    {
        // Only the password span (between the first `:` after the userinfo and
        // the `@`) is captured — scheme, user and host/db survive untouched.
        kind: 'connection_string_password',
        re: /:\/\/[^:/\s]+:([^@\s]+)@/g,
        modes: ['full'],
        group: 1,
    },
    {
        // Keyword-cued assignment: `api_key = "..."`, `password: foo`. The
        // negative lookbehind keeps ordinary prose ("the secret: ...") from
        // being mistaken for a variable assignment. The trailing negative
        // lookahead stops the greedy value group from swallowing what is
        // actually the *next* key ("secret: api_key = ...").
        kind: 'assigned_secret',
        re: /(?<!\bthe\s)\b(?:api[_-]?key|secret|token|password|passwd|pwd|credential|access[_-]?key|private[_-]?key|client[_-]?secret|passphrase)\b\s*[:=]\s*(["']?)([^\s"',]{8,})\1(?!\s*[:=])/gi,
        modes: ['full'],
        group: 2,
        suppress: isSuppressedAssignedSecret,
    },
    {
        kind: 'bearer_header',
        re: /\bBearer\s+([A-Za-z0-9._~+/=-]{16,})/g,
        modes: ['full'],
        group: 1,
    },
];
// high_entropy is a heuristic, not a plain-regex row, so it is applied as a
// separate pass after SECRET_PATTERNS (full mode only) rather than living in
// the table above. Candidate token shape per architecture.md.
const HIGH_ENTROPY_CANDIDATE_RE = /[A-Za-z0-9+/=_-]{24,}/g;
const HIGH_ENTROPY_MIN_LENGTH = 24;
const HIGH_ENTROPY_MIN_BITS = 4.5;
const HIGH_ENTROPY_CONTEXT_WINDOW = 48;
const HEX_ONLY_RE = /^[0-9a-f]+$/i;
const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Mirrors assigned_secret's keyword list plus bearer/authorization/auth (task-009
// precedent), scanned over the 48 chars immediately preceding the candidate token.
const HIGH_ENTROPY_CONTEXT_CUE_RE = /(api[_-]?key|secret|token|password|passwd|pwd|credential|bearer|authorization|auth|access[_-]?key|private[_-]?key|client[_-]?secret|passphrase)[\W_]{0,16}$/i;
/** True when `token` mixes at least two of {lowercase, uppercase, digit}. */
function hasTwoCharClasses(token) {
    let classes = 0;
    if (/[a-z]/.test(token))
        classes++;
    if (/[A-Z]/.test(token))
        classes++;
    if (/[0-9]/.test(token))
        classes++;
    return classes >= 2;
}
/**
 * Full-mode-only backstop (D-006): flags an opaque token as `high_entropy`
 * only when every cheap structural check passes (length, char classes,
 * non-hex, non-UUID, not an already-emitted placeholder) AND the expensive
 * entropy computation clears the threshold AND a credential keyword cues the
 * 48 chars immediately preceding the match. Cheap checks run before entropy
 * since entropy is the most expensive check.
 */
function applyHighEntropyBackstop(text, redactions) {
    let result = '';
    let lastIndex = 0;
    for (const match of Array.from(text.matchAll(HIGH_ENTROPY_CANDIDATE_RE))) {
        const token = match[0];
        const start = match.index;
        const end = start + token.length;
        if (token.length < HIGH_ENTROPY_MIN_LENGTH)
            continue;
        if (!hasTwoCharClasses(token))
            continue;
        if (HEX_ONLY_RE.test(token))
            continue;
        if (UUID_SHAPE_RE.test(token))
            continue;
        if (PLACEHOLDER_RE.test(token))
            continue;
        const contextStart = Math.max(0, start - HIGH_ENTROPY_CONTEXT_WINDOW);
        const context = text.slice(contextStart, start);
        if (!HIGH_ENTROPY_CONTEXT_CUE_RE.test(context))
            continue;
        if (shannonEntropy(token) < HIGH_ENTROPY_MIN_BITS)
            continue;
        result += text.slice(lastIndex, start) + formatPlaceholder('high_entropy');
        redactions.push('high_entropy');
        lastIndex = end;
    }
    result += text.slice(lastIndex);
    return result;
}
/**
 * Suppression list for `assigned_secret`'s captured value (edge case table):
 * placeholders, env references, template markers, null-ish words and
 * all-mask strings are not secrets even though they match the assignment shape.
 */
function isSuppressedAssignedSecret(value) {
    if (PLACEHOLDER_RE.test(value))
        return true;
    if (value.startsWith('process.env.'))
        return true;
    if (/^[${<]/.test(value))
        return true;
    if (/^(null|undefined|none|changeme)$/i.test(value))
        return true;
    if (/^[*x]+$/i.test(value))
        return true;
    return false;
}
/** Formats the placeholder substituted for a redacted span. */
export function formatPlaceholder(kind) {
    return `[REDACTED:${kind}]`;
}
/** Guards against re-matching an already-redacted placeholder span. */
export const PLACEHOLDER_RE = /\[REDACTED:[a-z_]+\]/;
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
export function redactCandidate(c, redact = redactSecrets) {
    const redactions = [];
    const title = redact(c.title, 'full');
    redactions.push(...title.redactions);
    const body = redact(c.body, 'full');
    redactions.push(...body.redactions);
    const tags = [];
    for (const tag of c.tags) {
        const scrubbedTag = redact(tag, 'full');
        if (scrubbedTag.redactions.length > 0) {
            redactions.push(...scrubbedTag.redactions);
            continue;
        }
        tags.push(tag);
    }
    return {
        candidate: { ...c, title: title.text, body: body.text, tags },
        redactions,
    };
}
/**
 * Shannon entropy of `token` in bits per character.
 *
 * Backstop for D-006 — a uniform 4-symbol alphabet is 2 bits/char, a pure
 * hex alphabet tops out under 4.0, real high-entropy tokens reach >= 4.5.
 */
export function shannonEntropy(token) {
    if (!token)
        return 0;
    const counts = new Map();
    let length = 0;
    for (const ch of token) {
        // Iterate by code point (for...of), not token.length (UTF-16 code
        // units) — a surrogate-pair character would otherwise inflate the
        // denominator relative to the actual symbol count counted above.
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
        length++;
    }
    let entropy = 0;
    counts.forEach((count) => {
        const p = count / length;
        entropy -= p * Math.log2(p);
    });
    return entropy;
}
/**
 * Replaces only `row.group`'s captured span per match, using the match's
 * absolute group index (via the regex `d`/indices flag) rather than
 * `match.replace(groupValue, placeholder)` — the latter mis-fires when the
 * group value also appears elsewhere in the match (e.g. a repeated token).
 */
function replaceGroupSpan(text, row, redactions) {
    const groupIndex = row.group;
    const flags = row.re.flags.includes('d') ? row.re.flags : `${row.re.flags}d`;
    const re = new RegExp(row.re.source, flags);
    let result = '';
    let lastIndex = 0;
    for (const match of Array.from(text.matchAll(re))) {
        const value = match[groupIndex];
        const indices = match.indices;
        const span = indices?.[groupIndex];
        if (value === undefined || !span)
            continue;
        if (PLACEHOLDER_RE.test(value))
            continue;
        if (row.suppress?.(value))
            continue;
        const [start, end] = span;
        result += text.slice(lastIndex, start) + formatPlaceholder(row.kind);
        redactions.push(row.kind);
        lastIndex = end;
    }
    result += text.slice(lastIndex);
    return result;
}
/**
 * Pure. Idempotent: redactSecrets(redactSecrets(t, m).text, m).text === redactSecrets(t, m).text.
 * Never throws — internal failure returns { text, redactions: [] } (fail open, D-002).
 *
 * Applies SECRET_PATTERNS in table order, one whole-text String.replace pass per
 * row, each pass consuming the previous pass's output. Rows are never passed to
 * .test()/.exec() — only replace/matchAll — to avoid the shared /g regex
 * lastIndex mutation hazard on module-level constants.
 */
export function redactSecrets(text, mode = 'full') {
    if (typeof text !== 'string') {
        return { text: text ?? '', redactions: [] };
    }
    try {
        let current = text;
        const redactions = [];
        for (const row of SECRET_PATTERNS) {
            if (!row.modes.includes(mode))
                continue;
            if (row.group !== undefined) {
                current = replaceGroupSpan(current, row, redactions);
            }
            else {
                current = current.replace(row.re, (match) => {
                    // Idempotence guard: a second pass must not re-match a span
                    // that a prior row already replaced with a placeholder.
                    if (PLACEHOLDER_RE.test(match))
                        return match;
                    redactions.push(row.kind);
                    return formatPlaceholder(row.kind);
                });
            }
        }
        if (mode === 'full') {
            current = applyHighEntropyBackstop(current, redactions);
        }
        return { text: current, redactions };
    }
    catch (err) {
        console.error('[claude-nexus] secret redaction failed, text passed through unmodified:', err);
        return { text, redactions: [] };
    }
}
//# sourceMappingURL=secrets.js.map