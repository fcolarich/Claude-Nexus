---
id: NOTE-20260730134513-3b
title: Preference-preservation addendum to extraction SYSTEM_PROMPT
date: 2026-07-30
tags: ["capture", "extraction", "prompt-tuning"]
status: open
resolved_by: []
---

src/capture/extract.ts SYSTEM_PROMPT gained a 2-bullet addendum: a short, explicit, durable preference/workflow-rule statement is exactly as extractable as a dense technical failure, regardless of surrounding window density. Root cause: a whole-session-vs-incremental-window vcc_compact extraction validation experiment found a single-line global user preference ("commit only on explicit user request") was correctly extracted by both the raw condenser and vcc_compact when run on a WHOLE session, but did not survive in ANY of 9 real incremental capture windows from that same session -- it was one line competing against 5-9 dense technical items per window. Applies to all extraction paths (whole-session, incremental, backfill); judged benign since it only raises recall of explicit directives and whole-session extraction already caught this class of fact correctly. Paired with the reflector.ts supersede-insert fix (ADR-20260730134500-2c) -- same design session, same incremental-capture-correctness investigation. Design rationale + rejected alternatives: .flow/flow-toolkit/flow-brainstorm-feature/nexus-incremental-capture-fixes-20260730-0954/design.md. Files: src/capture/extract.ts.
