# 0023. Graph and Human Review Are Optional

**Status:** Accepted · **Date:** 2026-10-13 · **Plan decision:** D10

## Decision

Keep graph storage and graph-context augmentation disabled by default. Keep human-review routes and ORM models documented as experimental until ingestion/query writes review items based on a defined confidence signal and corrections update the retrieval index.

## Rationale

The core RAG path must operate without Neo4j or a review database. Current graph evaluation has not demonstrated a retrieval gain, and the review data model is not connected to user-path decisions.

## Consequences and current state

`GRAPH_ENABLED` and `GRAPH_CONTEXT_ENABLED` default to false. Current scope and gaps are documented in `docs/graph-context.md` and `docs/HITL.md`.

