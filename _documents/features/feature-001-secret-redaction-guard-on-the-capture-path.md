---
id: FEAT-001
title: Secret-redaction guard on the capture path
status: planned
date: 2026-07-26
links: ["master-tooling-reference.md#GuardrailEngine (adaptive-memory-router, Pi.dev, tag: Adapt) - candidate off-the-shelf option: injection detection + PII/secret redaction + content filter in one component"]
tags: ["capture", "security", "secret-redaction"]
---

Add a regex/entropy-based secret, credential, and token screen to the memory-capture path (extract.ts post-processing or a gate in reflector.ts before write) so pasted secrets in transcripts are never permanently persisted into the memories table or its markdown export. Confirmed gap by direct grep of extract.ts/transcript.ts: no content-safety filter exists today, only the durable-knowledge-only style/tone system prompt. Sourced from the claude-nexus-improvements-synthesis.md research report, item 1 (highest-confidence finding).
