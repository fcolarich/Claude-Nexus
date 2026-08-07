---
id: FEAT-20260805151848-2a
title: Local model co-residency/routing plan for nexus's reranker + embedder stack
status: planned
date: 2026-08-05
links: ["../../LLM_Workflow_Optimization/_documents/proposals/local-inference-infrastructure/PROP-20260803-210126-rtx-3090-co-resident-config.md", "../../LLM_Workflow_Optimization/_documents/proposals/local-inference-infrastructure/PROP-20260803-210127-llama-swap.md", "ADR-012"]
tags: ["infrastructure", "needs-research"]
---

Needs research: implementation approach not yet decided — requires investigating a co-resident or swap-routed local model layout (e.g. via llama-swap) so nexus's local reranker (ADR-012) and mxbai-embed-large embedder run alongside other locally-served models without VRAM contention, rather than being planned in isolation.
