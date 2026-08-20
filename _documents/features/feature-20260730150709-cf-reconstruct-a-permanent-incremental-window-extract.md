---
id: FEAT-20260730150709-cf
title: Reconstruct a permanent incremental-window extraction validation harness
status: implemented
date: 2026-07-30
links: ["NOTE-20260730134513-3b", "FEAT-20260730150641-ad", "scripts/validate-extraction.mjs"]
tags: ["extraction", "testing"]
---

Built `scripts/validate-extraction.mjs`, a permanent eval-gate harness modeled on the existing `scripts/check-merge-model.mjs` pattern, that runs two fixture cases against the real extraction pipeline and asserts known facts survive: preference-crowding (NOTE-20260730134513-3b) and phase-section-cue (FEAT-20260730150641-ad). Both currently pass. This replaces the 13 tracked one-off `scratch-*.ts`/`.json` files that previously lived at the repo root for this purpose — removed as part of this work (commit 6f00f19) now that a maintainable, repeatable harness exists.
