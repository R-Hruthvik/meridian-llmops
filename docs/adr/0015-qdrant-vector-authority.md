# 0015. Qdrant Is the Vector Store of Record

**Status:** Accepted · **Date:** 2026-10-13 · **Plan decision:** D2

## Decision

Store dense vectors only in Qdrant. Disk chunk records retain text and metadata used to restore ingestion state and rebuild retrieval indexes; they do not serve as a second vector store.

## Rationale

Keeping one vector authority prevents stale or mismatched persisted vectors from silently entering retrieval.

## Consequences and current state

Reindexing computes vectors again from disk-backed chunks. Qdrant operations use the configured `qdrant` server or `qdrant_local` backend through `services/ingestion/vector_store.py`.

