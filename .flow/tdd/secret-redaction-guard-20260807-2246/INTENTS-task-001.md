# task-001 — Create secrets.fixtures.ts with SECRET_SAMPLES and BENIGN_SAMPLES

**Status:** PASS
**Timestamp:** 2026-08-07T23:24:00Z
**Implementer model:** claude-sonnet-4-6
**Reviewer:** flow-shared:tdd-reviewer (standard, risk=medium), 2 attempts

## Task

New file exporting SECRET_SAMPLES (9 kinds: aws_access_key, github_token, slack_token,
stripe_key, private_key_block, jwt, connection_string_password, assigned_secret,
high_entropy) and BENIGN_SAMPLES (7 false-positive shapes: git SHA, UUIDv4, sha256
digest, base64 JSON blob, hex build id, file path, npm integrity string). All values
synthetic/non-functional.

## Files changed

- `src/capture/secrets.fixtures.ts` (new)

## Review history

- Attempt 1: NEEDS_REVISION — blocker: high_entropy fixture's "token:" context cue
  collided with assigned_secret's keyword group, causing table-order misclassification.
  Warning: git_commit_sha was 39 hex chars, not 40.
- Fix applied: cue changed to "auth:"; SHA padded to a real 40-char hex value.
- Attempt 2: PASS. One non-blocking nit: sha256_digest fixture is 63 hex chars, not 64
  (SHA-256 is 64 hex chars). Does not affect test behavior (pure-hex exclusion holds at
  any length) — left as-is, not worth a third review round for a label-accuracy-only nit.

## Verdict

PASS.
