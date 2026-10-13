# 0014. Local FastEmbed Embeddings

**Status:** Accepted · **Date:** 2026-10-13 · **Plan decision:** D1

## Decision

Use `fastembed` with `BAAI/bge-small-en-v1.5` (384 dimensions, ONNX CPU) as the default local embedding implementation. Keep embedding behind the `Embedder` protocol and record the model and dimension in the index manifest.

## Rationale

This provides reproducible local embeddings without a PyTorch runtime or a paid embedding API. Persisted vectors must remain tied to the model that produced them.

## Consequences and current state

Model downloads may be needed on first use. The current implementation is in `services/ingestion/embedder.py`; model and dimension settings are in `packages/core/settings.py` and `services/ingestion/manifest.py`.

