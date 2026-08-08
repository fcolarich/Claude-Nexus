import { describe, it, expect, vi, afterEach } from 'vitest';
import { shannonEntropy, redactSecrets, redactCandidate, SECRET_PATTERNS, type SecretPatternRow } from './secrets.js';
import { BENIGN_SAMPLES, SECRET_SAMPLES, SECRET_WINDOW_TEXT } from './secrets.fixtures.js';

// Strict-mode kinds per architecture.md's SECRET_PATTERNS table — named
// high-confidence formats checked pre-extraction. jwt, connection_string_password,
// assigned_secret and high_entropy are 'full'-only and excluded here.
const STRICT_KINDS = new Set([
  'private_key_block',
  'aws_access_key',
  'github_token',
  'github_pat',
  'slack_token',
  'slack_webhook',
  'stripe_key',
  'anthropic_key',
  'openai_key',
  'google_api_key',
  'npm_token',
]);

const strictSamples = SECRET_SAMPLES.filter((s) => STRICT_KINDS.has(s.kind));

// Full-only kinds per architecture.md's SECRET_PATTERNS table — require the
// post-extraction gate (capture groups, keyword-cued suppression). high_entropy
// is covered separately since it's a heuristic, not a plain kind/value pair test.
const FULL_ONLY_KINDS = new Set(['jwt', 'connection_string_password', 'assigned_secret', 'bearer_header']);
const fullOnlySamples = SECRET_SAMPLES.filter((s) => FULL_ONLY_KINDS.has(s.kind));

// False positives that must survive assigned_secret's group-2 suppression list
// (impl-spec edge case table): placeholders, env references, null-ish values,
// and all-asterisk/x masks must never be redacted.
const ASSIGNED_SECRET_FALSE_POSITIVES = [
  { label: 'process.env reference', text: 'api_key = process.env.FOO' },
  { label: 'null value', text: 'token: null' },
  { label: 'placeholder angle brackets', text: 'password: <your-password>' },
  { label: 'all-asterisk mask', text: 'secret = ***' },
];

// Hex-only benign samples — the structural argument behind the 4.5 bits/char
// threshold (D-006): a pure hex alphabet (16 symbols) tops out at 4 bits/char
// in theory and sits meaningfully below that in practice, so it must never
// trip the entropy backstop.
const HEX_ONLY = /^[0-9a-fA-F]+$/;
const hexOnlyBenignSamples = BENIGN_SAMPLES.filter((s) => HEX_ONLY.test(s.value));

describe('shannonEntropy', () => {
  it('returns 0 for an empty string', () => {
    expect(shannonEntropy('')).toBe(0);
  });

  it('returns 0 for a single repeated character', () => {
    expect(shannonEntropy('aaaaaaaaaaaa')).toBe(0);
  });

  it('returns 2 for a uniform 4-symbol alphabet', () => {
    expect(shannonEntropy('abcdabcdabcdabcd')).toBe(2);
  });

  it.each(hexOnlyBenignSamples)('never exceeds 4.0 bits/char for hex-only sample $label', ({ value }) => {
    // Hex has a 16-symbol alphabet: log2(16) = 4.0 exactly, reached only by a
    // perfectly uniform digit distribution (e.g. build_id). That's still below
    // the 4.5 redaction threshold, so <= (not <) is the correct invariant.
    expect(shannonEntropy(value)).toBeLessThanOrEqual(4.0);
  });

  it('reaches at least 4.5 bits/char for the base64 JSON blob sample', () => {
    const sample = BENIGN_SAMPLES.find((s) => s.label === 'base64_json_config_blob');
    if (!sample) throw new Error('fixture missing base64_json_config_blob sample');
    expect(shannonEntropy(sample.value)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('redactSecrets — strict mode', () => {
  it.each(strictSamples)('redacts $kind to exactly one placeholder in strict mode', ({ kind, value }) => {
    const prefix = 'Before the secret: ';
    const suffix = ' — after the secret.';
    const text = `${prefix}${value}${suffix}`;

    const result = redactSecrets(text, 'strict');

    // Exactly one placeholder of the correct kind, surrounding prose untouched.
    expect(result.text).toBe(`${prefix}[REDACTED:${kind}]${suffix}`);
    expect(result.redactions).toEqual([kind]);
    // Zero verbatim occurrences of the raw value in the redacted output.
    expect(result.text.includes(value)).toBe(false);
  });

  it('returns redaction kinds in match order for two distinct strict secrets', () => {
    const first = strictSamples.find((s) => s.kind === 'aws_access_key');
    const second = strictSamples.find((s) => s.kind === 'github_token');
    if (!first || !second) throw new Error('fixture missing expected strict samples (aws_access_key, github_token)');

    const text = `Rotate this key: ${first.value} and also revoke this token: ${second.value}.`;

    const result = redactSecrets(text, 'strict');

    expect(result.redactions).toEqual([first.kind, second.kind]);
  });
});

describe('redactSecrets — full mode', () => {
  it.each(fullOnlySamples)('redacts $kind to exactly one placeholder in full mode', ({ kind, value }) => {
    const prefix = 'Before the secret: ';
    const suffix = ' — after the secret.';
    const text = `${prefix}${value}${suffix}`;

    const result = redactSecrets(text, 'full');

    expect(result.text.includes(`[REDACTED:${kind}]`)).toBe(true);
    expect(result.redactions).toEqual([kind]);
    expect(result.text.includes(value)).toBe(false);
  });

  it.each(fullOnlySamples)('produces zero redactions for $kind in strict mode', ({ kind, value }) => {
    const text = `Before the secret: ${value} — after the secret.`;

    const result = redactSecrets(text, 'strict');

    expect(result.redactions).toEqual([]);
    expect(result.text).toBe(text);
  });

  it('preserves postgres://user: and @host/db around [REDACTED:connection_string_password]', () => {
    const sample = SECRET_SAMPLES.find((s) => s.kind === 'connection_string_password');
    if (!sample) throw new Error('fixture missing connection_string_password sample');

    const result = redactSecrets(sample.value, 'full');

    expect(result.text).toBe('postgres://exampleuser:[REDACTED:connection_string_password]@localhost:5432/exampledb');
  });

  it('preserves the api_key= label around [REDACTED:assigned_secret]', () => {
    const sample = SECRET_SAMPLES.find((s) => s.kind === 'assigned_secret');
    if (!sample) throw new Error('fixture missing assigned_secret sample');

    const result = redactSecrets(sample.value, 'full');

    expect(result.text).toBe('api_key = "[REDACTED:assigned_secret]"');
  });

  it.each(ASSIGNED_SECRET_FALSE_POSITIVES)('does not redact $label', ({ text }) => {
    const result = redactSecrets(text, 'full');

    expect(result.redactions).toEqual([]);
    expect(result.text).toBe(text);
  });
});

describe('redactSecrets — high_entropy backstop', () => {
  const highEntropySample = SECRET_SAMPLES.find((s) => s.kind === 'high_entropy');
  if (!highEntropySample) throw new Error('fixture missing high_entropy sample');

  // Extracted from the fixture rather than hardcoded, so this stays in sync
  // if the sample token is ever rotated.
  const highEntropyToken = highEntropySample.value.match(/[A-Za-z0-9+/=_-]{24,}/)?.[0];
  if (!highEntropyToken) throw new Error('could not extract opaque token from high_entropy fixture');

  it('redacts a context-cued opaque token as high_entropy in full mode', () => {
    const result = redactSecrets(highEntropySample.value, 'full');

    expect(result.text.includes('[REDACTED:high_entropy]')).toBe(true);
    expect(result.redactions).toEqual(['high_entropy']);
    expect(result.text.includes(highEntropyToken)).toBe(false);
  });

  it('produces zero redactions for the high_entropy sample in strict mode', () => {
    const result = redactSecrets(highEntropySample.value, 'strict');

    expect(result.redactions).toEqual([]);
    expect(result.text).toBe(highEntropySample.value);
  });

  // Zero-false-positive bound (AC-6): every BENIGN_SAMPLES entry, unmodified
  // and with no context cue, must pass through full mode untouched.
  it.each(BENIGN_SAMPLES)('does not redact benign sample $label in full mode', ({ value }) => {
    const result = redactSecrets(value, 'full');

    expect(result.redactions).toEqual([]);
    expect(result.text).toBe(value);
  });

  it('does not redact the opaque token when no credential keyword precedes it within 48 chars', () => {
    const text = `Just a random string sitting here: ${highEntropyToken} in the middle of the log.`;

    const result = redactSecrets(text, 'full');

    expect(result.redactions).toEqual([]);
    expect(result.text).toBe(text);
  });

  it('does not redact a 40-char hex SHA even with a preceding context cue', () => {
    const sha = BENIGN_SAMPLES.find((s) => s.label === 'git_commit_sha');
    if (!sha) throw new Error('fixture missing git_commit_sha sample');
    const text = `The auth: ${sha.value} was rotated.`;

    const result = redactSecrets(text, 'full');

    expect(result.redactions).toEqual([]);
    expect(result.text).toBe(text);
  });

  it('does not redact a UUIDv4 even with a preceding context cue', () => {
    const uuid = BENIGN_SAMPLES.find((s) => s.label === 'uuidv4');
    if (!uuid) throw new Error('fixture missing uuidv4 sample');
    const text = `The auth: ${uuid.value} was rotated.`;

    const result = redactSecrets(text, 'full');

    expect(result.redactions).toEqual([]);
    expect(result.text).toBe(text);
  });

  it('does not redact a 23-char token even with a preceding context cue (below the 24-char minimum)', () => {
    const shortToken = BENIGN_SAMPLES.find((s) => s.label === 'short_opaque_token_23_char');
    if (!shortToken) throw new Error('fixture missing short_opaque_token_23_char sample');
    const text = `The auth: ${shortToken.value} was rotated.`;

    const result = redactSecrets(text, 'full');

    expect(result.redactions).toEqual([]);
    expect(result.text).toBe(text);
  });
});

describe('redactSecrets — purity and idempotence', () => {
  it('is idempotent: a second full-mode pass over the SECRET_WINDOW_TEXT output is a no-op', () => {
    const first = redactSecrets(SECRET_WINDOW_TEXT, 'full');
    const second = redactSecrets(first.text, 'full');

    expect(second.text).toBe(first.text);
    expect(second.redactions).toEqual([]);
  });

  it('does not mutate the input string', () => {
    const original = `Rotate this key: ${SECRET_SAMPLES[0].value} before EOD.`;
    const snapshot = original.slice();

    redactSecrets(original, 'full');

    expect(original).toBe(snapshot);
  });

  it('returns text equal to input and redactions: [] for a clean input', () => {
    const clean = 'This session had no secrets in it at all, just ordinary debugging prose.';

    const result = redactSecrets(clean, 'full');

    expect(result.text).toBe(clean);
    expect(result.redactions).toEqual([]);
  });

  it('leaves an already-redacted placeholder untouched by every row, including the entropy backstop', () => {
    // A literal placeholder embedded with a credential-cue context, positioned
    // so it would trip the high_entropy backstop's 48-char lookback if the
    // placeholder guard were not honored.
    const text =
      'The auth: [REDACTED:aws_access_key] was rotated and the api_key = "[REDACTED:aws_access_key]" too.';

    const result = redactSecrets(text, 'full');

    expect(result.text).toBe(text);
    expect(result.redactions).toEqual([]);
  });
});

// Structural stand-in for extract.ts's MemoryCandidate — secrets.ts stays
// dependency-free (D-011), so this test builds a duck-typed fixture rather
// than importing the real interface. Field names/shape mirror
// src/capture/extract.ts's MemoryCandidate exactly.
interface MemoryCandidateLike {
  title: string;
  body: string;
  memory_type: string;
  scope: string;
  decay_class: string;
  confidence: number;
  tags: string[];
  promotion_target: string;
}

function makeCandidate(overrides: Partial<MemoryCandidateLike> = {}): MemoryCandidateLike {
  return {
    title: 'clean title',
    body: 'clean body, nothing sensitive here.',
    memory_type: 'insight',
    scope: 'project',
    decay_class: 'implementation',
    confidence: 0.8,
    tags: ['ops', 'rotation'],
    promotion_target: 'none',
    ...overrides,
  };
}

describe('redactCandidate', () => {
  it("scrubs title and body in 'full' mode", () => {
    const first = SECRET_SAMPLES.find((s) => s.kind === 'aws_access_key');
    const second = SECRET_SAMPLES.find((s) => s.kind === 'github_token');
    if (!first || !second) throw new Error('fixture missing expected samples (aws_access_key, github_token)');

    const candidate = makeCandidate({
      title: `Rotate ${first.value}`,
      body: `Found ${second.value} in the logs.`,
    });

    const { candidate: result } = redactCandidate(candidate);

    expect(result.title).toBe(`Rotate [REDACTED:${first.kind}]`);
    expect(result.body).toBe(`Found [REDACTED:${second.kind}] in the logs.`);
  });

  it('drops a tag that triggers any redaction while clean tags survive in original order', () => {
    const secretSample = SECRET_SAMPLES.find((s) => s.kind === 'aws_access_key');
    if (!secretSample) throw new Error('fixture missing aws_access_key sample');

    const candidate = makeCandidate({
      tags: ['alpha', secretSample.value, 'beta', 'gamma'],
    });

    const { candidate: result } = redactCandidate(candidate);

    expect(result.tags).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('returns a new candidate object and does not mutate the input', () => {
    const secretSample = SECRET_SAMPLES.find((s) => s.kind === 'github_token');
    if (!secretSample) throw new Error('fixture missing github_token sample');

    const candidate = makeCandidate({
      title: `Token: ${secretSample.value}`,
      tags: ['keep', secretSample.value],
    });
    const snapshot = structuredClone(candidate);

    const { candidate: result } = redactCandidate(candidate);

    expect(result).not.toBe(candidate);
    expect(candidate).toEqual(snapshot);
  });

  it('aggregates redaction kinds across title, body and tags', () => {
    const awsSample = SECRET_SAMPLES.find((s) => s.kind === 'aws_access_key');
    const ghSample = SECRET_SAMPLES.find((s) => s.kind === 'github_token');
    const slackSample = SECRET_SAMPLES.find((s) => s.kind === 'slack_token');
    if (!awsSample || !ghSample || !slackSample) {
      throw new Error('fixture missing expected samples (aws_access_key, github_token, slack_token)');
    }

    const candidate = makeCandidate({
      title: `Rotate ${awsSample.value}`,
      body: `Found ${ghSample.value} in the transcript.`,
      tags: [slackSample.value, 'clean-tag'],
    });

    const { redactions } = redactCandidate(candidate);

    // Fields are scrubbed in declaration order — title, then body, then tags.
    expect(redactions).toEqual([awsSample.kind, ghSample.kind, slackSample.kind]);
  });

  it('accepts an injected redactor as an optional second argument, overriding the default', () => {
    const fakeRedact = vi.fn((text: string) => {
      if (!text.includes('SECRET')) return { text, redactions: [] };
      return { text: text.replace('SECRET', '[REDACTED:fake]'), redactions: ['fake'] };
    });

    const candidate = makeCandidate({
      title: 'has SECRET inside',
      body: 'no sensitive content here',
      tags: ['clean'],
    });

    const { candidate: result, redactions } = redactCandidate(candidate, fakeRedact);

    expect(fakeRedact).toHaveBeenCalled();
    expect(result.title).toBe('has [REDACTED:fake] inside');
    expect(redactions).toEqual(['fake']);
  });
});

describe('redactSecrets — surgical redaction preserves surrounding insight prose', () => {
  it('redacts a secret embedded mid-sentence without dropping or emptying the candidate body', () => {
    const stripeSample = SECRET_SAMPLES.find((s) => s.kind === 'stripe_key');
    if (!stripeSample) throw new Error('fixture missing stripe_key sample');

    const prefix = 'the API_KEY env var must be set to ';
    const suffix = ' before running the ingest job';
    const text = `${prefix}${stripeSample.value}${suffix}`;

    const result = redactSecrets(text, 'full');

    // Surrounding sentence survives byte-identically on both sides of the placeholder.
    expect(result.text.startsWith(prefix)).toBe(true);
    expect(result.text.endsWith(suffix)).toBe(true);
    expect(result.text).toBe(`${prefix}[REDACTED:${stripeSample.kind}]${suffix}`);
    // The candidate is not dropped or emptied.
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text.includes(stripeSample.value)).toBe(false);
    // Exactly one redaction is reported.
    expect(result.redactions).toEqual([stripeSample.kind]);
  });
});

describe('redactSecrets — internal fail-open on pattern throw', () => {
  // SECRET_PATTERNS is typed ReadonlyArray but is not Object.frozen at
  // runtime, so a single element can be swapped in place for the duration
  // of this test and restored in afterEach — no reassignment of the export.
  const mutablePatterns = SECRET_PATTERNS as unknown as SecretPatternRow[];
  let originalRow: SecretPatternRow | undefined;

  afterEach(() => {
    if (originalRow) {
      mutablePatterns[0] = originalRow;
      originalRow = undefined;
    }
    vi.restoreAllMocks();
  });

  it('fails open, returns input unchanged and logs (without the secret value) when a pattern row throws', () => {
    originalRow = mutablePatterns[0];

    // A row whose `re` has a throwing Symbol.replace — this is what
    // `text.replace(row.re, ...)` invokes internally, so it reliably
    // simulates a row-level throw without depending on regex internals.
    const throwingRow: SecretPatternRow = {
      kind: originalRow.kind,
      re: {
        [Symbol.replace]() {
          throw new Error('synthetic pattern failure');
        },
      } as unknown as RegExp,
      modes: originalRow.modes,
    };
    mutablePatterns[0] = throwingRow;

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const secretValue = 'AKIAIOSFODNN7EXAMPLE';
    const text = `Rotate this key: ${secretValue} before EOD.`;

    let result: ReturnType<typeof redactSecrets> | undefined;
    expect(() => {
      result = redactSecrets(text, 'full');
    }).not.toThrow();

    expect(result?.text).toBe(text);
    expect(result?.redactions).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();

    // No secret value may appear in the logged arguments.
    const loggedArgs = consoleErrorSpy.mock.calls.flat();
    for (const arg of loggedArgs) {
      const serialized = typeof arg === 'string' ? arg : String(arg);
      expect(serialized.includes(secretValue)).toBe(false);
    }
  });
});
