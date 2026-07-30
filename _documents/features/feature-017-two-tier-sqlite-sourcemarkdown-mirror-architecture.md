---
id: FEAT-017
title: Two-tier SQLite-source/markdown-mirror architecture
status: implemented
date: 2026-07-26
links: []
tags: ["memory", "architecture", "knowledge-vault"]
---

Nexus stores memories in SQLite as the source of truth and generates a markdown mirror via export.ts (ADR-014) for human inspection and Claude Code's native auto-memory MEMORY.md pipeline. This is the deliberate inverse of the knowledge-vault's Two-Tier Memory Architecture atom (ATOM-530, pi-hermes-memory pattern: markdown as source, SQLite as search mirror) -- Nexus chose SQLite-as-source for transactional integrity and embedding support, with markdown as a generated, disposable projection. Recorded as a documented architectural choice, not a gap.
