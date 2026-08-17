# Spec: Meridian LLMOps (Agentic RAG, Governance, & Continuous Eval)

## Problem Statement

Enterprise organizations deploying Large Language Model (LLM) applications encounter severe operational, security, and quality challenges:

1. **Hallucinations & Context Failures**: Naive linear RAG pipelines frequently return ungrounded responses due to poor chunking, outdated vector similarity search, and a lack of self-correction mechanisms.
2. **Security & Compliance Vulnerabilities**: Direct exposure of LLMs without centralized proxying leaves systems vulnerable to prompt injections, jailbreaks, PII leakage, and schema violations.
3. **Operational Blindspots & Silent Regressions**: Lack of unified OpenTelemetry tracing, token cost governance, and automated CI/CD evaluation leads to undetected accuracy regressions and cost spikes when prompts or models are updated.

Enterprise teams require a production-grade, self-healing LLMOps architecture that enforces strict pre- and post-generation guardrails, supports multi-hop entity reasoning alongside vector search, self-corrects ungrounded drafts before delivery, and blocks regression in CI/CD pipelines.

## Solution

A modular, enterprise-grade LLMOps and Agentic RAG platform built on Python 3.11+ and async LangGraph, featuring:

1. **AI Gateway & Security Perimeter**: Centralized LiteLLM proxy and NeMo Guardrails container enforcing API key quotas, provider failover, prompt injection defense, and PII masking before requests hit foundation models.
2. **Dual-Memory Hybrid Retrieval Engine**: Document ingestion pipeline utilizing structural chunking (hierarchy and headings), dual indexing into Qdrant (dense vectors) and Neo4j (entity knowledge graph), BM25 sparse search, and BGE-Reranker-Large cross-encoding.
3. **Resilient Self-Healing Cyclic State Machine**: LangGraph orchestration with an Agentic Router, a Critic Agent (LLM-as-a-judge) to score context groundedness, and an automated Query Reformulator that iteratively refines queries (up to 3 cycles) before falling back to safe refusal.
4. **Automated CI/CD Evaluation & Observability**: DeepEval quality gates integrated into GitHub Actions testing against a 100+ edge-case Golden Dataset (blocking PR merges on Faithfulness < 0.90 or Answer Relevancy < 0.80), with complete end-to-end trace telemetry in Langfuse.

## User Stories

1. As a security engineer, I want all incoming user queries intercepted by an input guardrail before reaching any LLM, so that prompt injections and jailbreaks are immediately blocked.
2. As a compliance officer, I want automated PII masking and redaction applied at the AI Gateway layer, so that sensitive customer identifiers are never leaked to external model providers.
3. As a developer, I want to authenticate against the platform using an `X-API-Key` header, so that my client application requests are authenticated and tracked against tenant rate limits.
4. As a platform administrator, I want the AI Gateway to transparently load-balance and failover across multiple LLM providers (e.g. OpenAI, Anthropic), so that upstream outages do not disrupt service availability.
5. As a data engineer, I want the document ingestion pipeline to parse multi-format files (PDF, Markdown, DOCX, HTML, TXT) with structural chunking, so that document hierarchies and section headings are preserved rather than sliced by naive token counts.
6. As a data engineer, I want ingested documents to be processed by a hybrid spaCy NER and LLM extractor, so that entities and relationships are populated accurately into the Neo4j Knowledge Graph.
7. As a data engineer, I want document chunks converted into dense vector embeddings and stored in Qdrant with rich payload metadata, so that semantic similarity searches return relevant contextual passages.
8. As a knowledge worker, I want to submit complex domain questions requiring multi-hop reasoning, so that the Agentic Router queries both Qdrant vector memory and Neo4j graph entities to assemble comprehensive answers.
9. As a knowledge worker, I want exact keyword queries (such as product SKUs, alphanumeric error codes, and entity names) matched via BM25 and fused with vector scores, so that exact-match recall is maximized.
10. As a system architect, I want candidate retrieved chunks re-scored by a BGE-Reranker-Large cross-encoder, so that only the most contextually relevant passages are supplied to the generation context window.
11. As an end user, I want every generated answer evaluated by an independent Critic Agent before delivery, so that ungrounded statements and hallucinations are intercepted.
12. As an end user, I want the system to automatically trigger a Query Reformulator when the Critic Agent flags missing context, so that alternative search angles are tried iteratively without manual reprompting.
13. As an end user, I want the system to gracefully return a clear refusal message if verified facts are not present after 3 reformulation cycles, so that I am never given confident falsehoods.
14. As a product manager, I want output responses validated against JSON schemas and policy filters via Output Guardrails, so that structured responses comply with enterprise format and tone constraints.
15. As an LLM engineer, I want every execution trace, latency metric, and token cost recorded in Langfuse with OpenTelemetry, so that I can inspect and optimize agent performance and operational expenses.
16. As an LLM engineer, I want a version-controlled Golden Dataset of 100+ edge-case and adversarial prompts, so that system quality and robustness can be measured deterministically.
17. As a DevOps engineer, I want DeepEval test assertions executed automatically in GitHub Actions on every pull request, so that code changes causing Faithfulness < 0.90 or Answer Relevancy < 0.80 are blocked from merging.
18. As a software engineer, I want the entire platform infrastructure (FastAPI, Qdrant, Neo4j, LiteLLM, Langfuse) spin-up ready via Docker Compose, so that I can develop, test, and debug locally with a single command.

## Implementation Decisions

1. **Runtime & Language**: Built on Python 3.11+ using FastAPI for async API routing, Pydantic v2 for data validation, and LangGraph for cyclic agent state orchestration (ADR-0001).
2. **Dual-Memory Persistence**: Qdrant Community Edition for high-performance dense vector storage and payload filtering; Neo4j Community Edition for Cypher-queried property graph entity networks (ADR-0002).
3. **Gateway & Guardrails Perimeter**: Standalone LiteLLM Proxy container paired with NeMo Guardrails container (YAML & Colang policies) positioned as the ingress barrier in front of upstream LLM endpoints (ADR-0003, ADR-0013).
4. **Observability**: Self-hosted Langfuse integration via OpenTelemetry exporters, capturing spans for Gateway requests, retrieval stages, LangGraph node executions, and LLM token usage (ADR-0004).
5. **Codebase Architecture**: Modular Monorepo containing separated services for the API gateway, RAG engine, document ingestion, critic evaluation, and CI/CD testbeds (ADR-0005).
6. **Ingestion & Entity Extraction**: Unstructured and PyMuPDF structural parsers with hybrid spaCy named-entity recognition and structured LLM JSON schema relationship extraction into Neo4j (ADR-0006, ADR-0011).
7. **Hybrid Retrieval & Reranker**: Dense vector search + BM25 keyword search fused via Reciprocal Rank Fusion (RRF), passed to `BAAI/bge-reranker-large` cross-encoder for top-k contextual filtering (ADR-0007).
8. **Self-Healing State Graph**: Stateful cyclic LangGraph flow:
   - `Input Guardrails` -> `Agentic Router` -> `Hybrid Retrieval & Rerank` -> `Draft Generator` -> `Critic Agent`.
   - If grounded: proceed to `Output Guardrails` -> `Response`.
   - If ungrounded and cycle count < 3: route to `Query Reformulator` -> `Hybrid Retrieval & Rerank`.
   - If cycle count >= 3: route to `Safe Refusal Response` -> `Output Guardrails` (ADR-0008).
9. **Authentication & Rate Limiting**: Header-based `X-API-Key` authentication enforced at the gateway with configurable per-tenant token bucket rate limits (ADR-0012).
10. **CI/CD Quality Gates**: Automated DeepEval test runner in GitHub Actions validating Faithfulness >= 0.90, Answer Relevancy >= 0.80, and Context Recall >= 0.75 across the Golden Dataset before allowing pull request merges (ADR-0009).
11. **DevOps Orchestration**: Multi-container `docker-compose.yml` defining networks, volumes, healthchecks, and environment configurations for all services (ADR-0010).

## Testing Decisions

- **Testing Philosophy**: Tests must evaluate observable external behaviors at the highest possible seams rather than asserting on private implementation details or internal node state variables.
- **Primary Testing Seam**: 
  - **Level 1 (Full System Seam)**: The asynchronous FastAPI HTTP endpoints (`/v1/chat/completions`, `/v1/query`, `/v1/ingest`) exercised via `httpx.AsyncClient` with real or mocked service dependencies.
  - **Level 2 (Agent Engine Seam)**: The LangGraph compiled state machine runner (`RagAgentGraph.ainvoke`), validating state transitions, cycle bounds, and terminal states.
  - **Level 3 (CI/CD Eval Seam)**: DeepEval assertion test suites executed against the Golden Dataset.
- **Prior Art & Standards**: Pytest with `pytest-asyncio`, DeepEval test runners, and WireMock/VCR fixtures for deterministic upstream LLM mocking during unit and integration test runs.

## Out of Scope

- Client-side mobile or web frontend user interfaces (the platform exposes standard REST/OpenAI-compatible APIs).
- Custom foundational LLM pre-training or fine-tuning infrastructure.
- Multi-cloud Kubernetes Helm chart deployment automation (Docker Compose is standard for local/CI; Kubernetes deployment manifests are deferred to infrastructure ops).
- Proprietary enterprise SaaS vendor-locked database integrations.

## Further Notes

- All configuration files, guardrail Colang rules, and DeepEval test parameters will be kept strictly version-controlled in the repository.
- Changes to domain concepts must be updated in `CONTEXT.md` in accordance with domain modeling practices.
