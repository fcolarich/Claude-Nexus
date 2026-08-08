# Implementation Spec: Secret-redaction guard on the capture path (FEAT-001)

## Constraint register (D-### IDs)

design.md's `## Constraints` bullets and architecture.md's `## Decisions` entries are numbered here; task `constraints` fields refer to these IDs.

| ID | Constraint | Source |
|---|---|---|
| D-001 | In-house only — regex + entropy, no third-party dependency on the capture path | design ## Constraints |
| D-002 | Fail open on classifier error — log and pass text through unmodified, never drop a candidate or halt capture | design ## Constraints |
| D-003 | No new DB schema or columns — pure in-memory transform on strings already flowing through `reflect()` | design ## Constraints |
| D-004 | One module, one exported `redactSecrets(text, mode)` + thin `redactCandidate()`; no strict/full wrapper pair, no second module | arch Decisions |
| D-005 | Gate 1 intercepts the single `extractionText` variable after the vcc branch, immediately before `extract()` | arch Decisions |
| D-006 | Entropy backstop: length ≥ 24, ≥ 4.5 bits/char, ≥ 2 char classes, non-hex, non-UUID, mandatory 48-char context cue | arch Decisions |
| D-007 | `redactions?: number` / `redaction_kinds?: string[]` optional on `ReflectResult`, undefined on early returns | arch Decisions |
| D-008 | One shared accumulator across both gates — raw span count, deduped+sorted kind set | arch Decisions |
| D-009 | Fail-open guarded twice — inside `redactSecrets` and at each `reflect()` call site; `deps.redact` injectable | arch Decisions |
| D-010 | A tag that triggers a redaction is dropped from `tags`, not placeholder-substituted | arch Decisions |
| D-011 | Patterns and thresholds are module constants in `secrets.ts` — no `config.ts` import, nothing in `extraction_models.yaml` | arch Decisions |
| D-012 | Gate 2 rewrites the candidate array before `embed()`, `findSimilarMemory()` and `insertMemory()`; the dedup/insert loop is not modified | arch Decisions |

## Implementation approach

**TDD, red/green pairs.** Every behavioural task ships as a test task followed by an implementation task on the same behaviour. Test tasks are expected to fail on completion (module or branch does not exist yet); implementation tasks are done when the paired test file passes and no earlier test regresses. Commit after each green pair — no task requires an all-at-once landing.

**Build the pure module before touching the pipeline.** `secrets.ts` has zero imports from the rest of the codebase (D-011), so it can be driven to completion against unit tests with no DB, no transcript, no Haiku. `reflector.ts` only gains call sites and a `try/catch`, which keeps the blast radius on the existing suite at "two new gate lines plus optional result fields" (AC-9).

**One shared fixture corpus.** `secrets.fixtures.ts` is written first and is the single source of truth for both `secrets.test.ts` (unit) and `reflector.test.ts` (pipeline). Threshold tuning therefore has exactly one place to move.

**Fixture values must be synthetic and scanner-safe.** Repo secret scanners and GitHub push protection fire on live-looking credential literals. Construct every `SECRET_SAMPLES` value with an obviously-fake, low-entropy body (`ghp_EXAMPLEEXAMPLE…`, AWS's documented `AKIAIOSFODNN7EXAMPLE`) that still satisfies the pattern's length and charset requirements. The one exception is the `high_entropy` sample, which needs real entropy — it carries no vendor prefix, so prefix-keyed scanners will not match it. Add a file header stating all values are synthetic.

**Regex hygiene (this is where the guard silently breaks).**
- `SECRET_PATTERNS` rows are `/g` regexes held as module constants. `RegExp.prototype.test`/`exec` mutate `lastIndex` on `/g` regexes and would make detection alternate between hit and miss across calls. Rule: only ever pass these regexes to `String.prototype.replace`/`matchAll`, never to `.test()`/`.exec()`; if a check is needed, clone with `new RegExp(re.source, re.flags)`.
- Patterns are applied in table order, whole-text pass per row, each pass consuming the previous pass's output. `private_key_block` is first so a PEM body is never chewed up token-by-token by later rows.
- `group` semantics: when a row sets `group`, replace only that capture group's span. Implement with a replacer function using the `offset` and group arguments and rebuild the match by slicing around the group's absolute index — do not `match.replace(groupValue, placeholder)`, which mis-fires when the group value also appears elsewhere in the match.
- Placeholder guard: `/\[REDACTED:[a-z_]+\]/` — a span already replaced by an earlier row (or by an earlier `reflect()` gate) must never be re-matched by a later row or by the entropy backstop. This is what makes the idempotence guarantee (D-004 interface contract) real rather than accidental.

**`redactCandidate` takes an optional injected redactor.** Deliberate extension of the architecture interface: `redactCandidate(c, redact: typeof redactSecrets = redactSecrets)`. `reflect()` passes `deps.redact ?? redactSecrets` into it. Rationale: without this, an injected throwing double reaches gate 1 only and the gate-2 fail-open path is untestable (D-009 exists specifically to make fail-open testable). Default parameter keeps the documented one-argument call shape valid.

**Gate wiring is three lines plus a wrapper.** `safeRedact(fn, text, mode)` is a local, non-exported helper in `reflector.ts` returning `{ text, redactions: [] }` on catch. Gate 2 uses a per-candidate `try/catch` rather than one around the whole `map`, so a single pathological candidate does not disable redaction for its siblings. `allRedactions: string[]` is declared once, before gate 1, inside `reflect()` — never module scope.

**Build artifacts.** `dist/` is committed in this repo (see the existing `chore: rebuild dist …` commits); the final task rebuilds it so the MCP server, CLI and hooks pick up the guard.

## Build order and dependencies per component

**Stage 0 — fixtures (`secrets.fixtures.ts`).** No dependencies. `SECRET_SAMPLES` + `BENIGN_SAMPLES` first, then `SECRET_WINDOW_TEXT` (prose window embedding every secret sample) since the window is assembled from the samples.

**Stage 1 — `secrets.ts`, inside-out.** Each step's test task depends only on the previous test task (same file, serialized) and each impl task on its test plus the previous impl:
1. `shannonEntropy` + module scaffold (`RedactionMode`, `RedactionResult`, placeholder helper) — no dependants yet, cheapest thing to get right.
2. Strict rows + the core `redactSecrets` replace loop (mode filter, kind accumulation in match order). Unblocks all reflector gate-1 work.
3. Full-mode rows (jwt, connection_string_password, assigned_secret, bearer_header) incl. capture-group span replacement and false-positive suppression.
4. `high_entropy` backstop (depends on 1 and 3 — it must skip placeholders emitted by 3).
5. Placeholder guard / idempotence hardening.
6. Internal `try/catch` fail-open.
7. `redactCandidate` (depends on the full pattern set being live so the tag-drop rule is exercised).

**Stage 2 — `reflector.ts` plumbing + gate 1.** Starts as soon as `redactSecrets` exists (end of Stage 1 step 2) and runs in parallel with Stage 1 steps 3-7 — different files, no shared surface. Order: type surface + `safeRedact` → gate-1 test → gate-1 wiring.

**Stage 3 — gate 2, observability, fail-open wiring.** Requires `redactCandidate` (Stage 1 step 7) and gate 1 landed. Order: gate-2 test → gate-2 wiring → observability test → observability wiring → fail-open test → fail-open wiring for gate 2.

**Stage 4 — closeout.** Full capture-suite regression pass (AC-9), file-map doc row, `dist/` rebuild.

Cross-component dependency summary: `secrets.fixtures.ts` → `secrets.test.ts` → `secrets.ts` → `reflector.ts` → `reflector.test.ts`. Nothing in `secrets.ts` imports anything from the project (D-011), so there is no cycle and no test needs a DB until Stage 2.

## Test strategy per component

### `secrets.ts` — unit, exhaustive, no mocks
Pure functions with no I/O; this is the only component where detection correctness lives, so it carries the heaviest assertion load. Table-driven `it.each` over `SECRET_SAMPLES` and `BENIGN_SAMPLES`.
- **Positive:** every `SECRET_SAMPLES` entry, embedded in surrounding prose, yields exactly one `[REDACTED:<expected kind>]`, the raw value appears zero times in the output, and the surrounding prose is byte-identical.
- **Negative (the false-positive bound, AC-6):** every `BENIGN_SAMPLES` entry in full mode yields `redactions: []` and returns text equal to input.
- **Mode isolation:** full-only kinds (jwt, connection string, assigned secret, bearer, high entropy) produce zero redactions in `'strict'` mode; every strict kind fires in both modes.
- **Entropy unit:** `shannonEntropy('')===0`, `'aaaa…'===0`, a uniform 4-symbol alphabet `===2`, any hex string `< 4.0` (this is the structural argument behind D-006 — assert it, do not assume it), a base64 JSON blob `>= 4.5`.
- **Purity/idempotence:** input string and input candidate are never mutated; `redactSecrets(redactSecrets(t,m).text,m).text === redactSecrets(t,m).text` for the full window fixture; a clean input returns text equal to input and `redactions: []`.
- **Fail-open (internal):** force a row-level throw (temporarily substitute a `SECRET_PATTERNS` entry whose `re` has a throwing `Symbol.replace`, restored in `afterEach`) and assert the input text is returned with `redactions: []` and nothing propagates.
- **`redactCandidate`:** title and body scrubbed, tags that trigger any redaction dropped while clean tags survive in order, a new object is returned, kinds aggregated across all three fields.

### `secrets.fixtures.ts` — no tests
It is test data, asserted *against*, not asserted *on*. A test over the fixtures would only restate the fixtures. Its correctness is established transitively: if a sample stops matching its declared kind, the table-driven positive test fails.

### `reflector.ts` — integration-style, using the existing injected-deps harness
Reuses the suite's existing pattern (temp SQLite DB + `deps.extract`/`deps.embed`/`deps.vcc` doubles). No new harness. Scope is deliberately narrow — placement and plumbing only, never detection semantics (already covered above), so the suite does not become a second copy of the pattern tests.
- **Gate 1 (AC-5a):** a fake extractor records the text it was handed; assert every `SECRET_SAMPLES` strict value appears zero times in that text, that placeholders are present, and that `BENIGN_SAMPLES` values pass through byte-identical.
- **Gate 1 bypass-proofing (D-005):** run once with a `deps.vcc` double that succeeds and once with one that fails; both must produce scrubbed extractor input.
- **Gate 2 (AC-5b, AC-7):** fake extractor returns candidates carrying secrets in title, body and tags — including one body mixing a real secret with durable insight prose; assert the values captured at `insertMemory` are redacted, the insight sentence survives verbatim, offending tags are gone, and `embed()` was called with the redacted body (D-012).
- **Observability (D-007/D-008):** `redactions` is a raw count and `redaction_kinds` a sorted unique list on the full path; `0`/`[]` on a clean window; both `undefined` on the origin-gate and observer-gate early returns.
- **Fail-open (AC-8):** inject `deps.redact` that throws unconditionally; `reflect()` resolves, no rejection, candidates are inserted with original text, `redactions === 0`, and both gates are shown to be contained (the throwing double reaches gate 2 via `redactCandidate`'s injected redactor).
- **Regression (AC-9):** the pre-existing dedup / reference-upgrade / origin-gate cases stay untouched; the only permitted edits are the new redaction cases.

## Edge cases and error handling per component

### `secrets.ts`
| Case | Handling |
|---|---|
| Non-string / null / undefined input | Guard at entry: return `{ text: text ?? '', redactions: [] }` — never throw (D-002) |
| Very large window text (100k+ chars) | Linear pass per row; no nested quantifiers, no backtracking-prone alternation over `.*`; entropy scan is a single `matchAll` over a bounded token regex |
| `/g` regex `lastIndex` leakage between calls | Never `.test()`/`.exec()` shared rows; `replace`/`matchAll` only |
| Already-redacted placeholder re-matched by a later row or the entropy pass | Placeholder guard regex; also makes the function idempotent |
| Capture-group value repeated inside the same match | Replace by absolute group offset, not by string search |
| Unterminated PEM (`BEGIN` with no `END`) | Accepted limitation, documented in a code comment — no unbounded "redact to end of text" fallback, which would destroy an entire window |
| `assigned_secret` matching non-secrets: `api_key = process.env.FOO`, `token: null`, `password: <your-password>`, `secret = ***` | Suppression list on group 2 — skip values that are placeholders, start with `process.env.`/`$`/`{`/`<`, are `null`/`undefined`/`none`/`changeme`, or are all `*`/`x` |
| Entropy token shorter than 24 chars, pure hex, or UUID-shaped | Structurally excluded before the entropy computation (D-006) — cheap checks first |
| Entropy token at string offset < 48 | Context-cue slice clamps at 0 |
| Token of a single repeated char | `shannonEntropy` returns 0; length guard already skipped it |
| Any internal throw | Module-level `try/catch` returns input unchanged, logs `[claude-nexus] secret redaction failed, text passed through unmodified:` with the error only — never the text |

### `reflector.ts`
| Case | Handling |
|---|---|
| `deps.redact` not supplied (every existing test) | `deps.redact ?? redactSecrets`; both new `ReflectResult` fields optional (D-007) so existing shape assertions hold |
| `deps.redact` throws | `safeRedact` catch at gate 1; per-candidate catch at gate 2; original text/candidate used, `redactions` unaffected, no rejection escapes `reflect()` (D-002, D-009) |
| One candidate throws during gate 2 | Per-candidate `try/catch` — that candidate passes through unredacted, siblings stay redacted |
| vcc succeeded vs. vcc failed | Both converge on `extractionText`; gate 1 sits after the conditional overwrite so neither path bypasses it (D-005) |
| Empty `candidates` array | Gate 2 is a no-op map; `redactions` still reported as `0` |
| Origin-gate / observer-gate early return | Neither new field is set — matches the `excluded_reason` convention (D-007) |
| Nothing matched | `redactions: 0`, `redaction_kinds: []`, no log line emitted |
| Redactions > 0 | Exactly one log line: `[claude-nexus] redacted N secret span(s): kind1, kind2` — counts and kinds only, never values |
| Content-addressed id / embedding derived from secret text | Impossible by placement: the candidate array is rewritten before the loop, so hashing, embedding, dedup and insert all consume redacted text (D-012) |
| Double-redaction across both gates | Harmless — idempotent placeholders; the count intentionally reports both spans (D-008) |

### `secrets.fixtures.ts`
| Case | Handling |
|---|---|
| Repo secret scanner / push protection flags fixture literals | Synthetic low-entropy bodies + documented example keys + explicit file header |
| A sample that no longer matches its declared kind after a pattern edit | Caught by the table-driven positive test — fixtures and patterns are edited together or the suite goes red |
| `SECRET_WINDOW_TEXT` drifting out of sync with `SECRET_SAMPLES` | Assemble the window from `SECRET_SAMPLES` programmatically where readable, and assert in `secrets.test.ts` that every sample value occurs in the window |
