---
id: NOTE-004
title: Evaluate mxbai-embed-large vs embeddinggemma
date: 2026-07-27
tags: ["embeddings", "nexus-config", "spike"]
status: open
resolved_by: []
---

Open question / planned spike: decide whether to switch Nexus embedding pipeline from mxbai-embed-large to embeddinggemma-300m.

Context: research (see _documents/research/best-prose-embedding-model-20260727-020154-synthesis.md) found no candidate with a decisive, same-methodology retrieval win over mxbai-embed-large. embeddinggemma-300m is the most promising candidate: smaller (300M vs 335M), first-party Ollama tag (`embeddinggemma`), and native quantization-aware training means a quantized variant costs almost nothing in quality. However its headline MTEB score (69.67) is on MMTEB-English-v2, a different/newer benchmark version than mxbai-embed-large's classic MTEB-v1 score (64.68) -- not directly comparable, so the apparent gap is not trustworthy on paper alone.

Next step: pull `embeddinggemma` via Ollama, re-embed a sample of existing Nexus memories plus a handful of real recall queries with both models, and compare top-k recall relevance directly. Only switch extraction_models.yaml if this same-corpus A/B shows a real improvement.
