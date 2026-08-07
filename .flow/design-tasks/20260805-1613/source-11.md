# Fix vcc_compact rendering quality and re-verify before re-enabling reflector's post-extraction shrink

**Source**: _documents/features/feature-20260802190757-2d-fix-vcc-compact-rendering-quality-and-re-verify-be.md

## Summary

ADR-015 disabled the reflector.ts module's call to vcc.compactFileInPlace() after a review discovered information loss in vcc_compact's rendering process. The renderer drops opaque Bash/PowerShell tool-result citations and loses small but critical tool results when they are not restated in prose elsewhere. Because compactFileInPlace() overwrites the only copy of the raw transcript JSONL in place, running a lossy renderer against it poses an unacceptable data-safety risk. ADR-015 identified fixing the rendering quality as the deferred precondition for re-enabling compression, but did not specify the implementation approach. This feature tracks both the fix to vcc_compact's rendering and the verification step to confirm the loss has been addressed, enabling reflector to safely resume using post-extraction shrinking. The implementation approach has not yet been decided and requires research.

## Key facts

- ADR-015 disabled reflector.ts's call to vcc.compactFileInPlace() due to rendering quality issues
- vcc_compact drops opaque tool-result citations from Bash/PowerShell output
- vcc_compact loses small-but-critical tool results when not restated in prose
- compactFileInPlace() overwrites the only copy of raw transcript JSONL, making lossy rendering unacceptable for data safety
- Fixing rendering quality is the explicit precondition for re-enabling the compression call
- Implementation approach for the fix has not yet been determined

## Open questions

- What implementation approach should be taken to fix vcc_compact's rendering to preserve tool-result citations and small critical results?
- What verification methodology should be used to confirm the rendering quality fix before re-enabling reflector's compression call?
