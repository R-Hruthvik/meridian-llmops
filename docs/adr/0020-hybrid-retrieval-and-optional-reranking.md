# 0020. Dense and BM25 Retrieval with Reciprocal-Rank Fusion

**Status:** Accepted · **Date:** 2026-10-13 · **Plan decision:** D7

## Decision

Retrieve candidates from Qdrant dense search and local BM25, combine ranks with reciprocal-rank fusion using `k=60`, and keep reranking optional and disabled by default until evaluation justifies it.

## Rationale

Dense retrieval handles semantic similarity; BM25 helps with identifiers and exact terms. Rank fusion combines both without treating incomparable raw scores as equivalent.

## Consequences and current state

The hybrid retriever and sparse BM25 index are under `services/rag_engine/retrieval/`. BM25 is in-process and its memory/build cost grows with the corpus. Rerankers are selected through settings and the current default is `none`.

