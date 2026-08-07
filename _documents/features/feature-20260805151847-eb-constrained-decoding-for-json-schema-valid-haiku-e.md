---
id: FEAT-20260805151847-eb
title: Constrained decoding for JSON-schema-valid Haiku extraction output
status: planned
date: 2026-08-05
links: ["../../LLM_Workflow_Optimization/_documents/proposals/local-inference-infrastructure/PROP-20260803-210128-constrained-decoding-xgrammar-llguidance-gbnf.md"]
tags: ["capture", "needs-research"]
---

Needs research: implementation approach not yet decided — requires investigating whether a constrained-decoding layer (XGrammar/llguidance/GBNF-style JSON schema enforcement) is available for the extraction call path (extract.ts) to guarantee schema-valid memory JSON output and eliminate parse-failure retries. Only applicable if/when nexus's extraction model is served locally rather than via the Anthropic API.
