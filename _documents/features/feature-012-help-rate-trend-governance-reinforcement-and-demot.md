---
id: FEAT-012
title: Help-rate-trend governance (reinforcement and demotion)
status: implemented
date: 2026-07-26
links: []
tags: ["memory", "governance", "ranking"]
---

governance.ts's governByHelpRate adjusts memory confidence up or down based on accumulated help_count/use_count trend over time (not just a static auto-approve threshold), gated behind DDR-006 with feedback-judge.ts providing the retrospective signal. Matches the improvement idea of adaptive promotion/demotion using help_rate trend rather than static thresholds -- already implemented.
