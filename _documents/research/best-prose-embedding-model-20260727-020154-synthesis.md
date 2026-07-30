# Best Prose Embedding Model vs. mxbai-embed-large (2026)

**Scope:** Open-weight text/prose embedding models in the ~300–450M param class, locally runnable (Ollama/llama.cpp/GGUF), compared against mxbai-embed-large — Claude Nexus's current embedding model. Priority: retrieval quality over speed (Nexus's embedding volume is low).

> Note on methodology: this research was run directly (WebSearch/WebFetch) rather than through the flow-research-detective pipeline — its retriever-agent failed 3x in a row with a context-overflow ("prompt too long") error, apparently while accumulating raw fetched page content across its own search loop. Flagged as a background task for a fix; not blocking for this research.

## Comparison table

| Model | Params | Dims | Benchmark score | License | Ollama / local | Quantized variant |
|---|---|---|---|---|---|---|
| **mxbai-embed-large-v1** (current) | 335M | 1024 (MRL down to 256) | MTEB avg **64.68** (56 EN datasets) | Apache-2.0 | `mxbai-embed-large` | Native binary quantization support |
| bge-large-en-v1.5 | 335M | 1024 | MTEB avg **64.23** | MIT | `bge-large` | — |
| gte-large-en-v1.5 (Alibaba) | 434M | 1024, 8192-token context | MTEB avg **65.39** | Apache-2.0 | GGUF available (no dedicated official Ollama tag confirmed) | Community GGUF quants exist |
| snowflake-arctic-embed-m-v2.0 | ~305M (113M non-embed) | 768 (MRL down to 128 bytes/vec) | MTEB-Retrieval (NDCG@10) **0.554**; multilingual | Apache-2.0 | `snowflake-arctic-embed2` | Quantization-aware trained (QAT) natively |
| embeddinggemma-300m (Google) | 300M | 768 (MRL) | MMTEB-English-v2 mean **69.67** — different/newer benchmark version, not directly comparable to MTEB-v1 numbers above | Gemma license | `embeddinggemma` (622MB) | Native QAT int4/int8/mixed, <1% degradation |
| Qwen3-Embedding-0.6B | 0.6B (largest here) | up to 1024 (MRL) | MTEB-multilingual **64.33** | Apache-2.0 | `qwen3-embedding:0.6b` (639MB) | Official GGUF quants (Q4_K_M etc.) |

## Key caveats

1. **Benchmark versions aren't apples-to-apples.** mxbai/bge/gte scores above are classic MTEB v1 (56 English datasets, avg score). EmbeddingGemma's 69.67 is on MMTEB-English-v2, a newer and differently-composed benchmark — the higher number reflects a different, harder/broader task mix, not a straightforward +5 point win over mxbai. Snowflake's number is retrieval-only NDCG@10, also not directly comparable to an average-of-56-tasks score. Treat cross-row comparisons as directional, not precise.
2. **gte-large-en-v1.5 is the closest same-generation, same-methodology beat** of mxbai on classic MTEB (65.39 vs 64.68) — same benchmark version, similar size class (434M vs 335M), same license (Apache-2.0), longer context window (8192 vs mxbai's 512). Weakest link: no first-party Ollama tag confirmed, would need a community GGUF or manual pull.
3. **EmbeddingGemma-300m** is the most interesting modern candidate: Google-trained, natively quantization-aware (near-lossless at int8/int4, meaning a *quantized* variant essentially loses nothing), smaller (300M) than mxbai, has a first-party Ollama tag, and scores well on retrieval-heavy tasks in its own benchmark suite. The catch is the benchmark-version caveat above — worth an empirical A/B against Nexus's actual memory corpus before trusting the sheet-number gap.
4. **Snowflake Arctic Embed m-v2.0** is multilingual-first and 768-dim (down from mxbai's 1024) — likely not worth it for Nexus, which is single-language prose.
5. **Qwen3-Embedding-0.6B** is the largest model here (0.6B, ~2x mxbai) with a comparable multilingual score, best quantization ecosystem (official GGUF), but no efficiency win — bigger model for a similar English score.

## Recommendation

**Keep mxbai-embed-large for now, but treat EmbeddingGemma-300m as the strongest upgrade candidate to validate empirically**, not gte-large:

- gte-large is a marginal, same-methodology win (+0.7 MTEB) but adds deployment friction (no first-party Ollama tag) for a gain unlikely to be noticeable on Nexus's small memory corpus.
- EmbeddingGemma-300m is smaller, first-party Ollama-available, and its native QAT means a quantized variant costs ~nothing in quality — genuinely lower-risk than swapping to a heavier model. But its headline score isn't on the same benchmark version as mxbai's, so the apparent gap is not trustworthy without a same-corpus test.
- None of the candidates show a decisive, comparable-methodology retrieval-quality win over mxbai-embed-large large enough to justify a switch on spec-sheet numbers alone.

**Concrete next step, if pursuing this further:** pull `embeddinggemma` via Ollama, re-embed a sample of existing Nexus memories + a handful of real recall queries with both models, and compare top-k recall relevance directly — that's the only way to resolve the benchmark-version ambiguity for this specific use case. Until that test is run, no change to `extraction_models.yaml` is justified.

## Sources

- [mxbai-embed-large-v1 – Hugging Face](https://huggingface.co/mixedbread-ai/mxbai-embed-large-v1)
- [mxbai-embed-large – Ollama library](https://ollama.com/library/mxbai-embed-large)
- [BAAI/bge-large-en-v1.5 – Hugging Face](https://huggingface.co/BAAI/bge-large-en-v1.5)
- [Alibaba-NLP/gte-large-en-v1.5 – Hugging Face](https://huggingface.co/Alibaba-NLP/gte-large-en-v1.5)
- [Snowflake/snowflake-arctic-embed-m-v2.0 – Hugging Face](https://huggingface.co/Snowflake/snowflake-arctic-embed-m-v2.0)
- [Arctic-Embed 2.0 paper](https://arxiv.org/html/2412.04506v2)
- [snowflake-arctic-embed2 – Ollama library](https://ollama.com/library/snowflake-arctic-embed2)
- [google/embeddinggemma-300m – Hugging Face](https://huggingface.co/google/embeddinggemma-300m)
- [EmbeddingGemma paper (arXiv 2509.20354)](https://arxiv.org/pdf/2509.20354)
- [EmbeddingGemma announcement – Hugging Face blog](https://huggingface.co/blog/embeddinggemma)
- [Qwen/Qwen3-Embedding-0.6B-GGUF – Hugging Face](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF)
- [dengcao/Qwen3-Embedding-0.6B – Ollama](https://ollama.com/dengcao/Qwen3-Embedding-0.6B)
- [qwen3-embedding – Ollama library](https://ollama.com/library/qwen3-embedding)
- [Best Ollama Embedding Models 2026 – morphllm.com](https://www.morphllm.com/ollama-embedding-models)
