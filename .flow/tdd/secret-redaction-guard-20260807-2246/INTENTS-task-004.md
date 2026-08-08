# task-004 — Create secrets.ts scaffold and shannonEntropy (green)

**Status:** PASS
**Timestamp:** 2026-08-07T23:36:00Z
**Implementer model:** claude-sonnet-4-6
**Reviewer:** flow-shared:tdd-reviewer (standard, risk=low), 1 attempt

## Files changed

- `src/capture/secrets.ts` (new)
- `src/capture/secrets.test.ts` (orchestrator fix: hex-only entropy assertion
  `< 4.0` → `<= 4.0`, resolving a needs_decision the implementer raised — build_id
  fixture legitimately hits exactly log2(16)=4.0, which is still below the 4.5
  redaction threshold)

## Verdict

PASS. Zero project imports (D-011). All scaffold exports present. shannonEntropy
correct. 6/6 shannonEntropy tests green.
