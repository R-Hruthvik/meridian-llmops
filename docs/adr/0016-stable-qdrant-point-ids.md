# 0016. Stable Qdrant Point Identifiers

**Status:** Accepted · **Date:** 2026-10-13 · **Plan decision:** D3

## Decision

Derive each Qdrant point ID as UUID5 from the logical chunk ID and a fixed namespace. Keep the logical `chunk_id` in the point payload with the full chunk text and metadata.

## Rationale

Stable UUIDs satisfy Qdrant's point-ID contract while allowing deterministic upserts and self-contained dense results.

## Consequences and current state

The mapping is implemented in `services/ingestion/vector_store.py`; tests cover deterministic IDs, payload round-trips, and update behavior.

