# task-004 — Thread session cwd into purge-origin.mjs's classifyOrigin() call

**Status:** PASS | **Timestamp:** 2026-08-08T17:03:00Z
**Reviewer:** flow-shared:tdd-reviewer (standard, risk=medium), 2 attempts

Files: `scripts/purge-origin.mjs` (extended).

Attempt 1 NEEDS_REVISION (real blocker): `?? ''` fallback for null-cwd
sessions resolved via `path.resolve('')` to the script's own
`process.cwd()` at runtime, creating a reachable false-exclusion path
under `--apply` that could permanently delete memories — violated the
script's own FAILS CLOSED principle. Fixed: fallback changed to
`'unknown-cwd'` (same convention as task-003), confirmed structurally
safe. Destructive `--apply`/VACUUM path confirmed untouched throughout.
