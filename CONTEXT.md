# Meridian LLMOps: Enterprise Agentic RAG Platform

A unified enterprise system providing self-healing agentic RAG, AI gateway governance, and automated CI/CD evaluation for production LLM workloads.

## Language

### Governance & Gateway

**AI Gateway**:
The central proxy layer handling LLM provider routing, load balancing, credential management, and execution logging.
_Avoid_: LLM router, API wrapper, model proxy

**Input Guardrail**:
Pre-execution security checks that intercept and block prompt injections, jailbreaks, and PII leakage before data reaches any LLM.
_Avoid_: Prompt sanitizer, pre-filter, input validator

**Output Guardrail**:
Post-generation verification validating response schemas, compliance policies, and tone before returning results to clients.
_Avoid_: Response cleaner, post-filter, output validator

### Memory & Ingestion

**Structural Chunking**:
Document ingestion chunking strategy based on semantic document hierarchy (headings, sections, tables) rather than fixed token lengths.
_Avoid_: Fixed token splitting, character slicing, naive chunking

**Dual-Memory Layer**:
The persistent storage architecture combining dense vector embeddings (Qdrant) for semantic search with an entity knowledge graph (Neo4j) for relationship traversal.
_Avoid_: Multi-store, hybrid database, vector-graph hybrid

**Hybrid Retrieval**:
Information retrieval combining dense vector similarity search with sparse lexical search (BM25) and reciprocal rank fusion.
_Avoid_: Multi-search, blended search, keyword-vector lookup

### Agentic Orchestration

**Agentic Router**:
The stateful orchestration node that analyzes incoming queries to determine retrieval pathways across vector, graph, or episodic memory stores.
_Avoid_: Query dispatcher, retrieval chooser, router agent

**Cross-Encoder Reranker**:
A specialized scoring model that reorders candidate retrieved chunks based on full query-context cross-attention.
_Avoid_: Re-sorter, second-pass ranker, chunk filter

**Critic Agent**:
An evaluation agent (LLM-as-a-judge) that inspects generated answers against retrieved context to detect hallucinations and verify groundedness.
_Avoid_: Fact checker, answer validator, verifier node

**Query Reformulator**:
A self-healing node that rewrites or decomposes queries into alternative search angles when the Critic Agent rejects a response.
_Avoid_: Query expander, prompt rewriter, search tuner

### Observability & Evaluation

**Golden Dataset**:
A version-controlled benchmark dataset of edge cases, expected responses, and adversarial inputs used for CI/CD evaluation gates.
_Avoid_: Test suite, sample questions, benchmark prompt list

**Continuous Evaluation Gate**:
An automated CI/CD step running DeepEval assertions on every pull request to enforce quality and latency thresholds.
_Avoid_: LLM test run, quality check, eval pipeline
