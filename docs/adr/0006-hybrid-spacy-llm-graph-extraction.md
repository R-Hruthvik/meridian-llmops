# 0006. Hybrid spaCy and LLM Pipeline for Knowledge Graph Extraction

**Status:** Superseded · **Date:** 2026-08-17

We chose a hybrid approach for entity and relation extraction into Neo4j: deterministic fast entity recognition using spaCy followed by LLM-based relation extraction and schema validation via structured JSON schemas. This balances parsing throughput and token cost efficiency while maintaining relationship accuracy in the knowledge graph.

**Current state (verified 2026-10-06):** No `spacy` dependency. Extraction is a hardcoded keyword list plus a capitalised-word regex at `services/ingestion/graph_store.py:76-93`.
