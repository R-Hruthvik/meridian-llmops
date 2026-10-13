# 0007. BGE-Reranker-Large for Contextual Reranking

**Status:** Superseded · **Date:** 2026-08-17

We selected `BAAI/bge-reranker-large` as the cross-encoder reranker for candidate chunks prior to generation. Cross-encoding candidate chunks against the original user query provides superior relevance scoring compared to bi-encoder vector similarity alone, dramatically reducing hallucination rates.

**Current state (verified 2026-10-13):** A FastEmbed `TextCrossEncoder` is available alongside a lexical overlap reranker. Both are opt-in; `RERANKER=none` is the default because the measured retrieval evaluation does not justify enabling reranking. See [ADR-0020](0020-hybrid-retrieval-and-optional-reranking.md).
