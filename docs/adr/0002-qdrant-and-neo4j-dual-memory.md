# 0002. Qdrant and Neo4j Community for Dual-Memory Storage

**Status:** Accepted (Neo4j optional) · **Date:** 2026-08-17

We selected Qdrant as the open-source vector database and Neo4j Community Edition as the knowledge graph database for the dual-memory layer. Qdrant delivers high-performance Rust-native vector search and rich payload filtering, while Neo4j provides robust property graph modeling and Cypher query execution for multi-hop entity reasoning.

**Current state (verified 2026-10-13):** Qdrant is the dense-vector source of record. Neo4j graph storage and graph-context augmentation are independently disabled by default; the core retrieval path uses Qdrant and local BM25. See [ADR-0015](0015-qdrant-vector-authority.md) and [ADR-0023](0023-graph-and-hitl-optional.md).
