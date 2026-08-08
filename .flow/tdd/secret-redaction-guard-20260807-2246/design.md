# Design: Secret-redaction guard on the capture path (FEAT-001)

## Problem

No content-safety filter exists anywhere in Nexus's capture path today. Confirmed by
direct grep of `extract.ts` / `transcript.ts`: the only text-shaping applied to
transcript content before persistence is style/tone guidance in the extraction
system prompt (durable-knowledge-only framing) — nothing screens for credentials,
API keys, tokens, or other secrets a user might paste into a session. If a pasted
secret is durable-sounding enough to survive Haiku's extraction judgment (e.g. "the
prod DB password is `X`" phrased as a fact worth remembering), it is written verbatim
into the `memories` table and, from there, into the markdown export mirror —
permanently, until manually found and deleted. This is the highest-confidence finding
from the 2026-07 improvements research pass (`claude-nexus-improvements-synthesis.md`,
item 1).

## Goals

- No secret/credential pattern that matches a known format (AWS/GitHub/Slack/Stripe
  tokens, PEM private-key blocks, JWTs, generic `key=password`-shaped connection
  strings) or a high-entropy opaque-token heuristic reaches either (a) the Haiku
  extraction API call or (b) the persisted `memories` table / markdown export.
- Redaction is surgical: only the matched secret span is replaced with a placeholder
  (`[REDACTED:<kind>]`); the surrounding durable insight in the same memory is kept.
- The guard fails open on its own internal errors — a bug in the redaction check must
  never be the reason a legitimate memory is silently lost or capture halts.
- Both gate points are pure, side-effect-free text transforms — easy to unit test in
  isolation from the Haiku call and the DB.

## Non-goals

- Not a general PII/content-safety filter (no name/email/address detection). Scope is
  strictly credential-shaped secrets, per FEAT-001's spec wording.
- Not adopting GuardrailEngine or any other third-party redaction/PII library. Already
  decided in `_documents/features/implementation-plan.md` (Capture Identity &
  Guardrails section): a third-party dependency directly on the capture path is a
  trust-surface/supply-chain decision this project isn't defaulting into. GuardrailEngine
  remains a noted future swap-in candidate only if the in-house gate proves insufficient.
- Not retroactively scrubbing already-persisted memories. This feature guards the
  capture path going forward; a retroactive sweep (if ever needed) is a separate,
  explicitly-scoped follow-up, analogous to how `scripts/purge-origin.mjs` was built
  as a separate retroactive pass from `origin.ts`'s live gate.
- Not adding a quarantine/review workflow or new DB schema. Redact-in-place was chosen
  over quarantine specifically to avoid a new `review_status` state and new columns.

## Constraints

- In-house only (regex + entropy), no third-party dependency — carried over from
  implementation-plan.md, not re-litigated here.
- Fail-open on classifier error: if the redaction check itself throws, log and let the
  candidate/window text through unmodified rather than dropping it or halting capture.
  This mirrors the existing precedent in `src/capture/origin.ts` ("A classifier that
  cannot read the transcript must never be the reason a real memory is silently lost").
- No new DB schema or columns — this is a pure in-memory text transform on strings
  already flowing through `reflect()`.

## Proposed Approach: Dual gate (defense in depth)

Two gate points, sharing one redaction module (`src/capture/secrets.ts`, name TBD by
architect) exporting a single pure function, e.g. `redactSecrets(text: string): { text: string; redactions: string[] }`:

1. **Pre-extraction (light, high-confidence only):** in `reflect()`, after
   `readTranscriptWindow()` produces `window.text` / the vcc-compacted
   `extractionText`, run the same redaction function over that text before it is
   passed to `extract()`. Scoped to the highest-confidence, lowest-false-positive
   patterns (named credential prefixes like `AKIA`, `ghp_`, `xox[baprs]-`,
   `sk_live_`, and PEM `-----BEGIN...PRIVATE KEY-----` blocks) so it does not risk
   corrupting Haiku's extraction quality on the large, format-sensitive window text.
   Purpose: reduce exposure of raw secrets to the third-party Haiku API call itself,
   not just to Nexus's own storage.

2. **Post-extraction (authoritative, full pattern set + entropy):** in `reflect()`,
   immediately after `extract()` returns `candidates` and before the dedup/insert
   loop (current line ~136-142 in `reflector.ts`), run the full redaction function
   — named-format regexes plus a Shannon-entropy check on long opaque substrings —
   over each candidate's `title` and `body`. This is the last-line, authoritative
   check: even if pre-extraction misses something, or Haiku echoes/paraphrases a
   secret it wasn't shown verbatim, nothing reaches `insertMemory()` unredacted.

Both gates call the same underlying function so detection logic is defined once and
tested once; the two call sites differ only in which pattern subset they pass in
(`{ mode: 'strict-prefixes' }` vs `{ mode: 'full' }`, exact shape left to architect).

On a match, replace only the matched span with `[REDACTED:<kind>]` (e.g.
`[REDACTED:aws_key]`, `[REDACTED:high_entropy]`) — never drop or quarantine the whole
candidate. Log a count of redactions per `reflect()` call (no secret content in the
log) for observability, mirroring how `origin.ts`'s `excluded_reason` surfaces on
`ReflectResult` today.

### Alternatives considered

- **Post-extraction only:** simpler (one call site, no risk of corrupting extraction
  input), and sufficient to meet FEAT-001's literal spec wording. Rejected in favor
  of the dual gate because it leaves raw secrets flowing to the third-party Haiku API
  on every session, which the post-extraction-only approach cannot address.
- **Pre-extraction only:** would keep secrets out of the Haiku call, but full-pattern
  + entropy scrubbing on the entire transcript window risks false-positive rewrites
  of legitimate high-entropy content (hashes, base64 blobs, session ids) that Haiku
  needs to see intact to extract meaning correctly. Rejected as the sole gate for
  that reason — kept only in its light, high-confidence form as gate 1.

## Key Questions (for architect)

- Exact function signature/module boundary for the shared redaction logic (single
  `secrets.ts` module with a `mode` param, vs. two thin wrapper functions calling a
  shared core) — architect's call based on `extract.ts`/`origin.ts` module conventions.
- Exact regex pattern list and entropy threshold/window-size tuning (e.g. Shannon
  entropy ≥ X bits over a token of length ≥ Y before it's flagged) — needs concrete
  values, not just "an entropy check." Architect should propose defaults; testable
  against a fixture set of real credential formats vs. real non-secret high-entropy
  strings (hashes, UUIDs, base64 config blobs) to bound the false-positive rate.
  This is the one place in this feature that most benefits from an explicit
  test-driven pass rather than an intuition-based threshold.
- Whether the pre-extraction gate operates on `window.text` (raw condensed) or the
  vcc-compacted `extractionText` (post `compactWindowLines`), or both — reflector.ts's
  current flow computes `extractionText` conditionally after `window.text` exists;
  architect should confirm the correct single point to intercept so the guard can't
  be bypassed by either code path.
- Where `redactSecrets`'s redaction-count/kind gets surfaced on `ReflectResult` (new
  optional field, e.g. `redactions: number`) for observability/testing, matching the
  existing `excluded_reason` precedent.

## Success Criteria

- A fixture transcript window containing at least one instance of each named
  credential format (AWS key, GitHub token, Slack token, Stripe key, PEM private-key
  block, JWT, generic connection-string password) produces zero verbatim occurrences
  of the secret value in: (a) the text passed to the (fake, test-injected) extractor,
  and (b) any resulting `MemoryCandidate.title`/`body` before `insertMemory()` is
  called.
- A fixture transcript window containing realistic non-secret high-entropy strings
  (a UUID, a base64-encoded small JSON blob, a git commit SHA) produces zero
  redactions — the entropy backstop does not fire on ordinary technical content.
- A memory candidate whose body mixes a real secret with genuinely durable insight
  text (e.g. "the API_KEY env var must be set to `sk_live_...` before running
  the ingest job") is redacted in place — the surrounding sentence about the env var
  requirement survives, only the key value is replaced.
- Forcing an internal error in the redaction function (e.g. via a test double) results
  in `reflect()` completing normally with the original, unredacted text passed through
  — fail-open confirmed, no exception propagates out of `reflect()`.
- `reflect()`'s existing test suite (`reflector.test.ts`) continues to pass unmodified
  except where it now asserts on redaction behavior — no regression to dedup/insert/
  origin-gate logic already covered.

---
**Checkpoint — DESIGN**
- Goal: no known-format secret or high-entropy opaque token reaches the Haiku API call or persisted storage; surgical in-place redaction, not candidate-dropping.
- Constraint: in-house regex+entropy only (no third-party dep), fail-open on internal error, no new DB schema.
- Approach: dual gate — light high-confidence prefix/PEM scrub pre-extraction (protects the Haiku API call), full pattern-set + entropy scrub post-extraction on candidate title/body before insert (authoritative last-line check). Shared redaction module, two call sites in `reflector.ts`.
- Open question for architect: concrete regex list + entropy threshold tuning, and the exact interception point for pre-extraction text (`window.text` vs `extractionText`).
