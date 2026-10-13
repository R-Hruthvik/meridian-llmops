# 0018. Persisted Index Manifest and Consistency Gate

**Status:** Accepted · **Date:** 2026-10-13 · **Plan decision:** D5

## Decision

Persist embedding model, vector dimension, chunker version, creation time, and chunk count in `storage/index_manifest.json`. Compare the manifest and Qdrant count with current settings and disk chunks at startup; refuse retrieval when the index is inconsistent. Provide an explicit reindex operation.

## Rationale

Embedding or chunker changes can make stored vectors incompatible with current queries. Detecting this at startup is safer than silently serving mixed data.

## Consequences and current state

The manifest and checks are implemented in `services/ingestion/manifest.py`; startup, readiness, query gating, and rebuilding are wired through the RAG app and `scripts/reindex.py`. Reindexing replaces the configured vector collection.

