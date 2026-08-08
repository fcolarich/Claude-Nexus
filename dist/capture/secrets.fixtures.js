/**
 * Shared fixture corpus for secrets.test.ts and reflector.test.ts.
 *
 * All values below are SYNTHETIC and NON-FUNCTIONAL. Every SECRET_SAMPLES entry
 * is format-valid for its SECRET_PATTERNS kind (matches length/charset), but its
 * body is an obviously fake, low-entropy placeholder (documented vendor example
 * keys, "EXAMPLE" repeats) so repo secret scanners and push protection do not
 * fire on this file. The lone exception is `high_entropy`, which needs real
 * entropy to exercise the backstop and therefore carries no vendor prefix that
 * a prefix-keyed scanner would match.
 */
export const SECRET_SAMPLES = [
    {
        kind: 'aws_access_key',
        // AWS's own documented example access key id — not a real credential.
        value: 'AKIAIOSFODNN7EXAMPLE',
    },
    {
        kind: 'github_token',
        value: 'ghp_EXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLEX',
    },
    {
        kind: 'slack_token',
        value: 'xoxb-EXAMPLE0000000000EXAMPLE',
    },
    {
        kind: 'stripe_key',
        value: 'sk_test_EXAMPLE1234567890EXAMPLE',
    },
    {
        kind: 'private_key_block',
        value: '-----BEGIN RSA PRIVATE KEY-----\n' +
            'MIIEXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLE==\n' +
            '-----END RSA PRIVATE KEY-----',
    },
    {
        kind: 'jwt',
        value: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJFWEFNUExFIn0.EXAMPLESIGNATUREEXAMPLESIGNATURE',
    },
    {
        kind: 'connection_string_password',
        value: 'postgres://exampleuser:examplepass123@localhost:5432/exampledb',
    },
    {
        kind: 'assigned_secret',
        value: 'api_key = "EXAMPLEEXAMPLE12"',
    },
    {
        kind: 'high_entropy',
        // No vendor prefix, real entropy — the one sample that must NOT be low-entropy.
        // Mandatory 48-char context cue precedes the opaque token (D-006). Cue word is
        // "auth" (not "token") — assigned_secret's keyword group excludes "auth", but
        // includes "token", and assigned_secret runs earlier in SECRET_PATTERNS table
        // order, so a "token:" cue would be misclassified as assigned_secret first.
        value: 'The auth: Qx7Zm2Pv9Lk4Bn8Wr3Ty6Uh5Gs1Cf0Ea was rotated.',
    },
    {
        kind: 'bearer_header',
        value: 'Bearer EXAMPLETOKEN1234567890ABCDEFGHIJ',
    },
];
export const BENIGN_SAMPLES = [
    {
        label: 'git_commit_sha',
        value: 'c4df7f8196351255aced4a01f273bec492f49678',
    },
    {
        label: 'uuidv4',
        value: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    },
    {
        label: 'sha256_digest',
        value: 'sha256:9bdbf709b396333cc4a84c0402960b37c748e3d64c97a2c8b4b92a6d0e736b6',
    },
    {
        label: 'base64_json_config_blob',
        // Base64 of a small JSON config object, no surrounding context cue.
        value: 'eyJob3N0IjoibG9jYWxob3N0IiwicG9ydCI6NTQzMiwiZGVidWciOmZhbHNlLCJyZXRyaWVzIjozfQ==',
    },
    {
        label: 'build_id',
        value: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    },
    {
        label: 'long_file_path',
        value: '/home/user/projects/claude-nexus/dist/capture/reflector.test.js',
    },
    {
        label: 'npm_integrity_string',
        value: 'sha512-oVhVwqLIsB0zZzz2CQaJ+hM03hDh+/aRb1i58l88oBQNzAsGZg1v4x4hM0Ln9SN3XvEHplzz3qhJdD4gAXpLKw==',
    },
    {
        // 23 chars, mixed-class, non-hex, non-UUID — otherwise entropy-shaped but
        // one char short of the high_entropy backstop's 24-char minimum (D-006).
        label: 'short_opaque_token_23_char',
        value: 'Ax1Bz2Cy3Dw4Ev5Fu6Gt7H9',
    },
];
/**
 * A realistic condensed transcript window: ordinary session prose with every
 * SECRET_SAMPLES value and every BENIGN_SAMPLES value embedded inline, so one
 * fixture exercises both the positive (must redact) and false-positive
 * (must pass through) paths. Built by interpolating the sample arrays rather
 * than hardcoding values a second time, so it cannot drift out of sync with
 * SECRET_SAMPLES/BENIGN_SAMPLES if a sample is edited or added.
 */
export const SECRET_WINDOW_TEXT = `We were debugging the deploy pipeline this afternoon and I want to capture
what we found before it slips my mind.

First, the AWS access key rotation. The old id was ${SECRET_SAMPLES[0].value} and it needs
to be revoked in IAM before end of day.

While pairing on the CI script I noticed a stray GitHub token committed to the
scratch file: ${SECRET_SAMPLES[1].value} — that repo needs a force-push cleanup.

The on-call bot posts to Slack using ${SECRET_SAMPLES[2].value}, which should
live in the secrets manager instead of the shell profile.

Billing tests were failing because someone hardcoded a Stripe test key:
${SECRET_SAMPLES[3].value} — swapped it for an env var reference.

Also found a private key checked into the deploy scripts directory:
${SECRET_SAMPLES[4].value}
That whole file needs to be shredded, not just git-rm'd.

The staging auth service handed back this bearer JWT during a debug session:
${SECRET_SAMPLES[5].value} — it's short-lived but still shouldn't be logged.

Someone pasted the full staging connection string into the incident channel:
${SECRET_SAMPLES[6].value} — rotating the password now.

The Terraform var file has ${SECRET_SAMPLES[7].value} sitting in plaintext,
which the security review flagged.

One more thing from the rotation ticket: ${SECRET_SAMPLES[8].value}

The internal dashboard call failed auth with ${SECRET_SAMPLES[9].value} in the
request headers, which shouldn't have been logged either.

For context, none of the following should ever be touched by the redactor —
they just look secret-shaped. The commit that introduced the regression was
${BENIGN_SAMPLES[0].value}, tracked under session id ${BENIGN_SAMPLES[1].value}.
The release artifact's checksum is ${BENIGN_SAMPLES[2].value}, and the config
blob we diffed against was ${BENIGN_SAMPLES[3].value}. The CI run's build id
was ${BENIGN_SAMPLES[4].value}, referenced from the log at
${BENIGN_SAMPLES[5].value}. The lockfile recorded the package integrity as
${BENIGN_SAMPLES[6].value}. One of the trace ids in the span was
${BENIGN_SAMPLES[7].value}, nothing unusual about it.

Anyway, once the rotations land we should be clear to close out the incident
and write up the postmortem.`;
//# sourceMappingURL=secrets.fixtures.js.map