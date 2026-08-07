# Validate cited ADR/DDR id before Fix-1 reference-upgrade supersede

**Source**: _documents/features/feature-20260730150659-74-validate-cited-adrddr-id-before-fix-1-reference-up.md

## Summary

This feature proposes adding a validation step within the reflector.ts component's `isReferenceUpgrade` path to verify that any cited ADR/DDR identifier in a reference candidate actually exists before proceeding with a supersede-insert upgrade operation. The validation would check the cited id against the result of `readDecisionIndex(opts.cwd)`, which is already available at the `reflect()` call site. The rationale is to prevent hallucinated decision identifiers—such as a non-existent "ADR-999" that the extraction model might emit—from incorrectly triggering a supersede of a real, existing decision memory. The feature was explicitly flagged as an open TODO in the related architecture decision record (ADR-20260730134500-2c) but was intentionally deferred from that change's shipped scope in order to keep the modification limited to two files.

## Key facts

- The validation should be performed in reflector.ts's `isReferenceUpgrade` path.
- The check must validate the cited ADR/DDR id against the output of `readDecisionIndex(opts.cwd)`.
- `readDecisionIndex(opts.cwd)` is already in scope at the `reflect()` call site.
- The feature guards against hallucinated identifiers (e.g., non-existent "ADR-999") causing unwarranted supersede operations.
- It was marked as an open TODO in ADR-20260730134500-2c but deliberately excluded from that ADR's shipped implementation to maintain scope.
- Status is "planned" as of 2026-07-30.
- Tags: capture, reflector, data-integrity.

## Open questions

- What error handling or logging should occur when an ADR/DDR id validation fails?
- Should a failed validation skip the supersede entirely, or fall back to a different operation?
- Are there edge cases (e.g., dynamically generated or provisionally named references) that should bypass this check?
