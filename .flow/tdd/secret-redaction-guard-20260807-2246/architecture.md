# Architecture: Secret-redaction guard on the capture path (FEAT-001)

## Components

### secrets.ts (`src/capture/secrets.ts`)
**Responsibility:** Owns all secret-detection and in-place redaction logic as pure, side-effect-free string transforms — it knows nothing about the DB, the transcript, or the extractor.
**Interface:**
```ts
// Public API — src/capture/secrets.ts

/** 'strict' = named high-confidence formats only (pre-extraction gate).
 *  'full'   = strict + JWT + connection-string password + assigned-secret
 *             + high-entropy backstop (post-extraction gate). */
export type RedactionMode = 'strict' | 'full';

export interface RedactionResult {
	text: string;          // redacted text; identical reference-value when nothing matched
	redactions: string[];  // one kind label per replaced span, in match order
}

/** Pure. Idempotent: redactSecrets(redactSecrets(t, m).text, m).text === redactSecrets(t, m).text.
 *  Never throws — internal failure returns { text, redactions: [] } (fail open). */
export function redactSecrets(text: string, mode?: RedactionMode): RedactionResult;

/** Convenience wrapper for the post-extraction gate. Scrubs title, body and tags
 *  of one candidate in 'full' mode. Returns a new candidate; never mutates input.
 *  A tag that triggers a redaction is DROPPED, not placeholder-substituted. */
export function redactCandidate(c: MemoryCandidate): { candidate: MemoryCandidate; redactions: string[] };

/** Exported for tests + threshold tuning only. Shannon entropy in bits/char. */
export function shannonEntropy(token: string): number;

/** Exported for tests: the ordered pattern table actually applied. */
export const SECRET_PATTERNS: ReadonlyArray<{ kind: string; re: RegExp; group?: number; mode: RedactionMode }>;
```

### reflector.ts (`src/capture/reflect()`) — modified
**Responsibility:** Owns *where* the two gates fire in the capture pipeline and the fail-open wrapper around them; carries no detection logic of its own.
**Interface:**
```ts
// Changed public surface — src/capture/reflector.ts

export interface ReflectDeps {
	extract?: Extractor;
	embed?: (text: string) => Promise<Float32Array | null>;
	vcc?: { compactWindowLines: typeof compactWindowLines; compactFileInPlace: typeof compactFileInPlace };
	redact?: typeof redactSecrets;   // NEW — injectable so tests can force a throw
}

export interface ReflectResult {
	// ...existing fields unchanged...
	excluded_reason?: string | null;
	redactions?: number;         // NEW — total spans replaced across both gates
	redaction_kinds?: string[];  // NEW — unique kind labels, sorted, deduped
}

// Internal, not exported:
// function safeRedact(fn, text, mode): RedactionResult  — try/catch => { text, redactions: [] }
```

### secrets.fixtures.ts (`src/capture/secrets.fixtures.ts`)
**Responsibility:** Owns the shared corpus of positive (real-format credential) and negative (ordinary high-entropy technical) strings that both `secrets.test.ts` and `reflector.test.ts` assert against, so threshold tuning has one source of truth.
**Interface:**
```ts
export const SECRET_SAMPLES: ReadonlyArray<{ kind: string; value: string }>;
export const BENIGN_SAMPLES: ReadonlyArray<{ label: string; value: string }>;
/** A full condensed-window fixture embedding every SECRET_SAMPLES value in prose. */
export const SECRET_WINDOW_TEXT: string;
```

---

## Data Flow

### Gate 1 — pre-extraction scrub (protects the Haiku API call)
1. `reflect()` passes the origin gate and the observer gate as today.
2. `reflect()` computes `extractionText` — `window.text`, overwritten by `compacted.text` when vcc succeeded (existing lines ~125-132, unchanged).
3. Immediately after that block and **before** `extract()` is called, `reflect()` calls `safeRedact(redact, extractionText, 'strict')`.
4. `redactSecrets` replaces each matched span with `[REDACTED:<kind>]` and returns the kind list.
5. `reflect()` assigns the result back to `extractionText` and accumulates the kinds into a local `allRedactions: string[]`.
6. `extract(extractionText, ...)` runs on the scrubbed text. Neither the vcc branch nor the raw branch can bypass the gate — both converge on the single `extractionText` variable first.

### Gate 2 — post-extraction scrub (authoritative, pre-insert)
1. `extract()` returns `candidates: MemoryCandidate[]`.
2. Before the `for (const c of candidates)` dedup/insert loop, `reflect()` maps each candidate through `safeRedact`-wrapped `redactCandidate` in `'full'` mode.
3. `redactCandidate` scrubs `title`, `body`, and each entry of `tags`; a tag that produced any redaction is removed from the array.
4. The redacted candidate array replaces `candidates`; kinds are appended to `allRedactions`.
5. The dedup/insert loop then runs unchanged on redacted text — so `embed(c.body)`, `findSimilarMemory`, `insertMemory` and the reference-upgrade path all see redacted content, and the content-addressed id is computed from redacted text.
6. `reflect()` returns with `redactions: allRedactions.length` and `redaction_kinds: [...new Set(allRedactions)].sort()`.

### Fail-open on internal error
1. `redactSecrets` wraps its own body in try/catch; a pattern-level failure returns the input text with `redactions: []`.
2. `safeRedact` in `reflect()` wraps the *call* in try/catch, so an injected `deps.redact` double that throws is also contained.
3. Either catch logs `console.error('[claude-nexus] secret redaction failed, text passed through unmodified:', err)` — no secret content in the log, mirroring `origin.ts`'s fail-open precedent.
4. `reflect()` continues to dedup/insert with unmodified text; no exception escapes.

### Observability
1. Early returns (origin gate, observer gate) leave `redactions` / `redaction_kinds` **undefined** — same convention as `excluded_reason`, which is only set when it applies.
2. On the full path, `redactions` is always present (`0` when nothing matched).
3. When `redactions > 0`, `reflect()` logs one line: `[claude-nexus] redacted N secret span(s): kind1, kind2` — counts and kinds only, never values.

---

## Storage

**No DB schema change.** No new columns, no new tables, no `review_status` state. Everything below is in-memory or source constants.

### Placeholder format
```
[REDACTED:<kind>]      # kind is snake_case, matches the SECRET_PATTERNS kind label
                       # e.g. [REDACTED:aws_access_key], [REDACTED:high_entropy]
```

### SECRET_PATTERNS table (source constants in secrets.ts, applied in this order)
```
kind                        mode    pattern (JS regex source)
private_key_block           strict  -----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----
aws_access_key              strict  \b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA|ACCA)[A-Z0-9]{16}\b
github_token                strict  \b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b
github_pat                  strict  \bgithub_pat_[A-Za-z0-9_]{22,255}\b
slack_token                 strict  \bxox[baprse]-[A-Za-z0-9-]{10,}\b
slack_webhook               strict  https://hooks\.slack\.com/services/[A-Za-z0-9/_-]{20,}
stripe_key                  strict  \b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b
anthropic_key               strict  \bsk-ant-[A-Za-z0-9_-]{20,}\b
openai_key                  strict  \bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b
google_api_key              strict  \bAIza[0-9A-Za-z_-]{35}\b
npm_token                   strict  \bnpm_[A-Za-z0-9]{36}\b
jwt                         full    \beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b
connection_string_password  full    \b[a-z][a-z0-9+.\-]*:\/\/[^\s:/@]+:([^\s/@]{3,})@   # group 1 only
assigned_secret             full    (api[_-]?key|secret|token|password|passwd|pwd|credential|access[_-]?key|private[_-]?key|client[_-]?secret|passphrase)\s*[:=]\s*["']?([^\s"',;]{8,})["']?   # group 2 only
bearer_header               full    \b(?:Bearer|Authorization:\s*Bearer)\s+([A-Za-z0-9._~+/=-]{16,})   # group 1 only
high_entropy                full    (heuristic — see below, not a plain regex)
```
`group` semantics: when set, only that capture group's span is replaced, so `postgres://user:` and `@host/db` survive around `[REDACTED:connection_string_password]`.

### high_entropy heuristic (full mode only)
```
candidate token regex:  /[A-Za-z0-9+/=_-]{24,}/g
flagged only if ALL hold:
  length          >= 24
  shannonEntropy  >= 4.5 bits/char
  charClasses     >= 2 of {lowercase, uppercase, digit}
  not pure hex    !/^[0-9a-f]+$/i          # excludes git SHAs, md5/sha256 digests
  not UUID shape  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  not a placeholder already emitted by an earlier pattern
  context cue     the 48 chars preceding the token match
                  /(api[_-]?key|secret|token|password|passwd|pwd|credential|bearer|authorization|auth|access[_-]?key|private[_-]?key|client[_-]?secret|passphrase)[\W_]{0,16}$/i
```

### Fixture corpus (test data model)
```
SECRET_SAMPLES:  aws_access_key, github_token, slack_token, stripe_key,
                 private_key_block, jwt, connection_string_password,
                 assigned_secret, high_entropy (context-cued opaque token)
BENIGN_SAMPLES:  git commit SHA (40 hex), UUIDv4, sha256:<64 hex> digest,
                 base64 of a small JSON config blob (no context cue),
                 a 32-char lowercase hex build id, a long file path,
                 an npm package integrity string
```

---

## Decisions

### One module, one function, a `mode` parameter
**Decision:** Single `src/capture/secrets.ts` exporting `redactSecrets(text, mode)` plus the thin `redactCandidate()` convenience wrapper; no separate strict/full wrapper functions.
**Alternatives:** Two exported wrappers (`redactStrict` / `redactFull`) over a private core; two separate modules.
**Rationale:** Matches `origin.ts` — one module, one exported classifier, config passed in as a parameter. Detection logic is defined once and tested once; the `mode` field on each pattern row is the only branch, which keeps the pattern table readable as a single flat list. Extra wrappers would be the "premature helper" the project's style rules reject.

### Pre-extraction gate intercepts `extractionText`, after the vcc branch
**Decision:** Gate 1 fires on the single `extractionText` variable immediately before `extract()` is called, not on `window.text` and not inside `readTranscriptWindow`.
**Alternatives:** Scrub `window.text` inside `transcript.ts` (like the existing tool-result scrubber, which operates on `rawLines`); scrub in both places.
**Rationale:** `reflect()` computes `extractionText = window.text` and then conditionally overwrites it with vcc's output — scrubbing `window.text` is bypassed entirely whenever vcc succeeds. The post-vcc assignment is the one point both code paths converge on, so the guard cannot be routed around. Accepted residual: the local `vcc_compact` subprocess still receives raw `window.rawLines`. That is a local process, not a third-party network call, and the goal of gate 1 is explicitly the Haiku API boundary. Scrubbing `rawLines` would also mean re-implementing detection over JSON-escaped content.

### Entropy threshold 4.5 bits/char, length ≥ 24, plus a mandatory context cue
**Decision:** The entropy backstop fires only when a ≥24-char opaque token has Shannon entropy ≥ 4.5 bits/char, mixes at least two character classes, is not pure hex / UUID-shaped, **and** is preceded within 48 chars by a credential keyword.
**Alternatives:** Entropy threshold alone (typical 3.5-4.0 over ≥20 chars, the common trufflehog-style default); no entropy check at all (named formats only).
**Rationale:** 4.5 bits/char is above the *theoretical maximum* of a hex alphabet (4.0), so every git SHA, md5/sha256 digest and UUID is structurally excluded rather than excluded by luck — that is what makes the "zero redactions on benign fixtures" criterion robust instead of threshold-fragile. Base64-encoded JSON config blobs do clear 4.5, which is why the context cue is mandatory rather than advisory: an unlabelled base64 blob in prose is ordinary technical content, the same blob after `api_key=` is a secret. The pair (entropy + proximity) is what bounds the false-positive rate; either alone does not.

### `redactions` / `redaction_kinds` as optional ReflectResult fields
**Decision:** Add `redactions?: number` and `redaction_kinds?: string[]`, populated only on the full capture path (`0` / `[]` when nothing matched), left undefined on the origin-gate and observer-gate early returns.
**Alternatives:** A required `redactions: number` on every return path; a nested `redaction: { count, kinds }` object; no field at all, log-only.
**Rationale:** Exactly mirrors the `excluded_reason` precedent — optional, set only where meaningful — so existing `reflector.test.ts` assertions on early-return shapes stay valid and the success criterion "existing suite passes unmodified" holds. Two flat fields beat a nested object for a two-value payload. Log-only would make the redaction assertions in the new tests depend on console spying.

### Both gates share one accumulator; kinds are deduped, counts are not
**Decision:** `redactions` is the raw span count across both gates; `redaction_kinds` is the sorted unique set.
**Alternatives:** Per-gate counts (`pre_redactions` / `post_redactions`).
**Rationale:** The count answers "did anything fire, how much" for observability; the kind set answers "what kind" for tests. Splitting by gate would add two more fields to serve a debugging question that the log line already answers, and the dual gate is deliberately redundant — a secret caught twice is the design working, not a number worth reporting separately.

### Fail-open guarded twice: inside `redactSecrets` and at the `reflect()` call sites
**Decision:** `redactSecrets` never throws (internal try/catch returning the input unchanged), and `reflect()` additionally wraps every call in a local `safeRedact` helper.
**Alternatives:** Guard only inside `secrets.ts`; guard only in `reflect()`.
**Rationale:** The internal guard covers real pattern failures. The call-site guard is what makes the fail-open success criterion testable — a test injects `deps.redact` that throws, which the module's own try/catch can never see. `deps.redact` is added to `ReflectDeps` for exactly this reason, following the existing `deps.extract` / `deps.vcc` injection convention.

### Redact tags by dropping them, not by placeholder substitution
**Decision:** `redactCandidate` scrubs `title` and `body` in place, but a tag that triggers any redaction is removed from the `tags` array entirely.
**Alternatives:** Leave tags untouched (design doc says title/body only); substitute the placeholder into the tag.
**Rationale:** Tags are 2-5 short model-authored keywords used for retrieval — `[redacted:aws_access_key]` as a tag is retrieval noise with no surviving insight to preserve, unlike a body sentence. Including tags in the scrub costs one `filter` and closes the only remaining candidate field that reaches `insertMemory`.

### Thresholds and patterns live in code, not `extraction_models.yaml`
**Decision:** `SECRET_PATTERNS`, the entropy threshold, the length floor and the context-cue window are module constants in `secrets.ts`.
**Alternatives:** Expose them under a `redaction:` block in `extraction_models.yaml` alongside `exclude:`.
**Rationale:** `exclude:` is config because the denylist is user-specific and changes without a release. Credential formats and the entropy threshold are neither — they change only with a code change plus a fixture test, and a user-editable threshold is a foot-gun that can silently disable the guard. Constants also keep the module dependency-free (no `config.ts` import), which is what makes it a pure, isolated unit test target.

### Redaction happens before embedding, dedup and content-id hashing
**Decision:** Gate 2 rewrites the candidate array before the dedup/insert loop, so `embed()`, `findSimilarMemory()` and `insertMemory()` all consume redacted text.
**Alternatives:** Redact inside the loop just before each `insertMemory` call.
**Rationale:** Redacting later would still leak the secret into the embedding vector and into the content-addressed id derived from the body — both persisted. Rewriting the array up front means the loop needs no modification at all, which is what keeps the existing dedup/upgrade tests untouched.

---

## Open Questions
<!-- These must be resolved before /plan runs. Planner will fail if ambiguous. -->
- None. All four design-doc Key Questions are resolved above: module boundary (single `secrets.ts`, `redactSecrets(text, mode)`), concrete pattern table and entropy tuning (4.5 bits/char, ≥24 chars, ≥2 char classes, non-hex/non-UUID, mandatory 48-char context cue), interception point (`extractionText` after the vcc branch, before `extract()`), and observability surface (`redactions?: number` + `redaction_kinds?: string[]` on `ReflectResult`).
