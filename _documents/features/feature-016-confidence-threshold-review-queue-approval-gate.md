---
id: FEAT-016
title: Confidence-threshold review-queue approval gate
status: implemented
date: 2026-07-26
links: []
tags: ["memory", "review", "knowledge-vault"]
---

Memories below auto_approve_confidence (0.85, extraction_models.yaml) are stored with review_status='pending' and withheld from recall until a human approves them via the dashboard Review view (approve/reject buttons); high-confidence memories auto-approve. This is a lighter-weight, confidence-gated variant of the knowledge-vault's Memory Write Approval Gate pattern (ATOM-686, which proposes gating every write) -- Nexus's design deliberately trades full-gate friction for a confidence-threshold compromise, which is the correct call for its optimize-for-low-friction philosophy.
