# Secret-redaction guard on the capture path

**Source**: _documents/features/feature-001-secret-redaction-guard-on-the-capture-path.md

## Summary

This feature proposes adding a content-safety filter to the memory-capture pipeline to prevent secrets, credentials, and tokens from being persisted into the memories database or exported markdown files. The mechanism would use regex or entropy-based detection to screen user input before storage. The filter would be applied at a post-processing stage in extract.ts or as a gate in reflector.ts before data is written to the memories table. The feature addresses a confirmed gap: a grep audit of extract.ts and transcript.ts reveals no existing content-safety filter in the capture path—the current system relies only on style/tone guidance in the system prompt to encourage durable-knowledge focus, which does not prevent accidental secret leakage. The feature was sourced from the claude-nexus-improvements-synthesis.md research report as item 1 and was flagged as the highest-confidence finding. A reference to master-tooling-reference.md suggests investigating GuardrailEngine (an adaptive-memory-router component, Pi.dev) as a candidate off-the-shelf option that combines injection detection, PII/secret redaction, and content filtering.

## Key facts

- No content-safety filter currently exists in the capture path (extract.ts and transcript.ts).
- The current system prompt covers only style/tone guidance for durable-knowledge-only capture, not secret redaction.
- The proposed filter would use regex or entropy-based detection.
- The filter would be inserted either in extract.ts post-processing or as a gate in reflector.ts before write.
- This feature was the highest-confidence finding (item 1) from the claude-nexus-improvements-synthesis.md research report.
- GuardrailEngine is mentioned as a candidate off-the-shelf solution offering injection detection, PII/secret redaction, and content filtering.

## Open questions

- What is the precise scope of "secrets, credentials, and tokens"—should the filter detect API keys, passwords, SSH keys, database connection strings, or other categories?
- What entropy threshold or regex patterns would constitute a "secret" for redaction purposes?
- Should redacted content be logged for audit purposes or silently dropped?
- How would the filter handle false positives (e.g., intentional test fixtures containing dummy secrets)?
- Would GuardrailEngine (or any third-party solution) meet the project's integration and performance requirements?
