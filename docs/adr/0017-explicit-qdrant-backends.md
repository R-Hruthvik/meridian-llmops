# 0017. Explicit Qdrant Backends and Failures

**Status:** Accepted · **Date:** 2026-10-13 · **Plan decision:** D4

## Decision

Select `qdrant` (server) or `qdrant_local` (embedded/local client) explicitly through `VECTOR_BACKEND`. Propagate Qdrant read and write failures; do not substitute an in-memory vector store.

## Rationale

An invisible fallback can report successful ingestion while making data unavailable to later searches. The supported local backend uses the same Qdrant API and semantics.

## Consequences and current state

Configuration and client construction are in `packages/core/settings.py` and `services/ingestion/vector_store.py`. Tests verify Qdrant failures remain visible.

