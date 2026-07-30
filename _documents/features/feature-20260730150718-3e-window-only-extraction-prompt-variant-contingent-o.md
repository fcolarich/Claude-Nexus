---
id: FEAT-20260730150718-3e
title: Window-only extraction prompt variant (contingent on shared-addendum regression)
status: planned
date: 2026-07-30
links: ["NOTE-20260730134513-3b"]
tags: ["extraction", "prompt-tuning", "contingent"]
---

A window-only extraction prompt variant, gated by a mode flag on the Extractor type, as a more targeted alternative to the preference-preservation addendum shipped in the shared SYSTEM_PROMPT (NOTE-20260730134513-3b), which also affects whole-session/backfill extraction. Explicitly deferred during that fix's design because it would touch the exported Extractor type and every conforming caller (reflector.ts, backfill.ts, prompt-runner.ts, plus test fakes) -- out of the lean-scope guard for a two-file fix. Revisit only if the shared-addendum approach is later found to regress whole-session or backfill extraction quality; not needed otherwise.
