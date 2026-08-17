# Meridian LLMOps: Enterprise Agentic RAG Platform

> **Production-grade Enterprise LLMOps Platform: Self-Healing Agentic RAG, AI Gateway Guardrails, & Continuous CI/CD Evaluation**

---

## 🌟 System Architecture

Meridian unifies a multi-layer enterprise AI architecture into a single modular platform:

```
                      +-----------------------------+
                      |       Client Request        |
                      +--------------+--------------+
                                     | (X-API-Key)
                                     v
                 +---------------------------------------+
                 |       AI Gateway (LiteLLM / NeMo)     |
                 |  • Rate Limiting & Auth               |
                 |  • Input Guardrails (Injection & PII) |
                 +-------------------+-------------------+
                                     |
                                     v
                 +---------------------------------------+
                 |       LangGraph Cyclic RAG Engine     |
                 |  • Agentic Router                     |
                 +---------+-------------------+---------+
                           |                   |
            +--------------v----+         +----v--------------+
            | Qdrant Vector DB  |         | Neo4j Graph DB    |
            | (Dense Embeddings)|         | (Entity Relations)|
            +--------------+----+         +----+--------------+
                           \                  /
                            \   BM25 Lexical /
                             v              v
                 +---------------------------------------+
                 |   Reciprocal Rank Fusion + Reranker   |
                 |   (BAAI/bge-reranker-large)           |
                 +-------------------+-------------------+
                                     |
                                     v
                 +---------------------------------------+
                 |       Generator & Critic Agent        |
                 |  (LLM-as-a-judge Grounding Check)     |
                 +-------------------+-------------------+
                                     |
                       [Is Response Grounded?]
                       /                     \
                   (Yes)                     (No, Cycle < 3)
                     |                              |
                     v                              v
        +--------------------------+    +-----------------------+
        |     Output Guardrails    |    |  Query Reformulator   |
        |  (JSON Schema & Safety)  |    |  (Step-back & Entity) |
        +-------------+------------+    +-----------+-----------+
                      |                             | (Loop back)
                      v                             +---> [Rerank]
         +------------------------+
         |     Final Response     |
         +------------------------+
```

---

## 📦 Monorepo Structure

```
.
├── packages/
│   └── core/                     # Shared Pydantic v2 schemas, protocols & settings
├── services/
│   ├── gateway/                  # Standalone AI Gateway, auth, and NeMo input guardrails
│   ├── ingestion/                # Structural chunking, multi-format parsers, Qdrant & Neo4j stores
│   └── rag_engine/               # Cyclic LangGraph agent, hybrid retrieval, reranker & Langfuse
├── evals/
│   ├── golden_dataset.json       # 100+ edge-case & adversarial benchmark test cases
│   └── test_deepeval_ci.py       # DeepEval CI quality gate (Faithfulness >= 0.90)
├── tests/                        # Full unit and integration test suite
├── docs/                         # ADRs (0001-0013), Spec, and Domain Glossary (CONTEXT.md)
├── docker-compose.yml            # Multi-container orchestration (Qdrant, Neo4j, LiteLLM, Langfuse)
└── pyproject.toml                # Project dependencies & build configuration
```

---

## 🚀 Quickstart

### 1. Prerequisites
- Python 3.11+
- Docker & Docker Compose
- `uv` (recommended) or `pip`

### 2. Installation

```bash
# Clone the repository
git clone https://github.com/R-Hruthvik/meridian-llmops.git
cd meridian-llmops

# Create virtual environment and install dependencies
uv venv
source .venv/bin/activate
uv pip install -e ".[dev]"
```

### 3. Launch Infrastructure

```bash
docker-compose up -d
```

Services started:
- **LiteLLM Gateway Proxy**: `http://localhost:4000`
- **Qdrant Vector DB**: `http://localhost:6333`
- **Neo4j Graph Browser**: `http://localhost:7474`
- **Langfuse Observability**: `http://localhost:3000`

---

## 🧪 Testing & CI/CD Quality Gates

Run all unit tests, integration tests, and DeepEval Golden Dataset regression gates:

```bash
pytest tests/ evals/ -v
```

Run linter and strict typechecking:

```bash
ruff check .
mypy packages services evals --ignore-missing-imports --explicit-package-bases
```

---

## 📡 Primary API Endpoints

### Query Agentic RAG Pipeline
`POST /v1/query`
```json
{
  "query": "What storage does Meridian use for dense vectors?",
  "top_k": 3,
  "max_cycles": 3,
  "enforce_guardrails": true
}
```

### Ingest Document
`POST /v1/ingest`
```json
{
  "title": "Architecture Overview",
  "text": "Meridian platform uses Qdrant for vectors and Neo4j for graphs."
}
```

### Evaluate Guardrails Directly
`POST /v1/guardrails/check`
```json
{
  "text": "User email is test@company.com with SSN 000-11-2222"
}
```

---

## 📄 License & Standards

Architectural Decision Records (ADRs) and Domain Modeling references are versioned under `docs/adr/` and `CONTEXT.md`.
