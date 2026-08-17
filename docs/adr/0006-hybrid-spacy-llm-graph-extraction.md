# 0006. Hybrid spaCy and LLM Pipeline for Knowledge Graph Extraction

We chose a hybrid approach for entity and relation extraction into Neo4j: deterministic fast entity recognition using spaCy followed by LLM-based relation extraction and schema validation via structured JSON schemas. This balances parsing throughput and token cost efficiency while maintaining relationship accuracy in the knowledge graph.
