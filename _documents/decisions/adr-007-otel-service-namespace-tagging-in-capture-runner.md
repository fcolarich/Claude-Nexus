---
id: ADR-007
title: OTel service namespace tagging in capture runner
type: adr
date: 2026-06-26
status: accepted
supersedes: null
tags: ["observability", "otel", "langfuse", "capture", "runner"]
---

**Decision:** runner.ts sets process.env.OTEL_RESOURCE_ATTRIBUTES = 'service.namespace=nexus,automation=nexus' before spawning the Claude CLI, and settings.local.json adds env.OTEL_RESOURCE_ATTRIBUTES for the same purpose. All Nexus-originated spans are identifiable via service.namespace=nexus.

**Alternatives:** No tagging (original): automation and interactive traffic mixed in dashboards with no way to filter cost/latency by source. Tag only in settings.local.json: would miss detached runner.ts spawns that inherit a clean env. Custom Langfuse metadata field: possible but requires Langfuse-specific filtering rather than standard OTel attribute queries.

**Reason:** Detached capture runs (spawned by the Stop/PreCompact hook via runner.ts) share the same Langfuse/OTel pipeline as interactive Claude Code sessions. Without tagging it was impossible to filter automation traffic from human sessions in dashboards. Setting OTEL_RESOURCE_ATTRIBUTES in both runner.ts and settings.local.json ensures every Nexus-originated span carries service.namespace=nexus regardless of spawn path. No behavioral change — purely observability.
