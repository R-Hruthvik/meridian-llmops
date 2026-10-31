"""End-to-end tests for the full /v1/query path (not only /v1/retrieve)."""

import json

import pytest
from fastapi.testclient import TestClient

from services.rag_engine import app as app_module
from services.rag_engine.agent.graph import build_rag_agent_graph
from tests.fakes import FakeEmbedder, FakeLLM

QUERY_API_KEY = "query-e2e-key"
HEADERS = {"X-API-Key": QUERY_API_KEY, "X-Tenant-Id": "query-e2e-tenant"}


@pytest.fixture
def seeded_query_client(monkeypatch):
    monkeypatch.setenv(
        "API_KEYS", json.dumps({QUERY_API_KEY: {"tenant": "query-e2e-tenant", "role": "user"}})
    )
    embedder = FakeEmbedder(app_module.vector_store.dim)
    llm = FakeLLM(content="Qdrant is a vector database used for dense similarity search [1].")
    app_module.ingestion_pipeline.embedder = embedder
    app_module.retriever.embedder = embedder
    app_module.llm_client = llm
    app_module.vector_store.ensure_collection()
    app_module.ingestion_pipeline.ingest_text(
        title="Query Fixture",
        text=(
            "Qdrant is a vector database used for dense similarity search. "
            "It stores embeddings and supports filtered payload queries."
        ),
        source="query_fixture.md",
        tenant_id="query-e2e-tenant",
    )
    app_module.retriever.update_chunks(app_module.vector_store.get_all_chunks())
    app_module.agent_graph = build_rag_agent_graph(
        retriever=app_module.retriever,
        graph_store=app_module.graph_store,
        llm_client=llm,
        llm_config_getter=app_module._resolve_active_llm_config_with_secrets,
        min_dense_score=0.0,
        verify_mode="citations",
    )
    return TestClient(app_module.app)


def test_query_end_to_end_tracks_answer_fields(seeded_query_client):
    client = seeded_query_client
    resp = client.post(
        "/v1/query",
        headers=HEADERS,
        json={"query": "What is Qdrant?", "top_k": 3, "max_cycles": 2, "enforce_guardrails": True},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["query"] == "What is Qdrant?"
    assert data["answer_status"] == "answered"
    assert data["verified"] is False
    assert data["cycle_count"] == 1
    assert data["verification"]["status"] == "citations_ok"
    assert data["source_chunks"], "full pipeline must retain retrieved sources"
    assert len(data["sources"]) == len(data["source_chunks"])
    assert data["timings_ms"]["total"] >= 0


def test_query_end_to_end_respects_top_k(seeded_query_client):
    client = seeded_query_client
    resp = client.post(
        "/v1/query",
        headers=HEADERS,
        json={"query": "vector database embeddings", "top_k": 1, "max_cycles": 1},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["source_chunks"]) <= 1
    assert len(data["sources"]) <= 1


def test_query_end_to_end_unanswerable_returns_insufficient_context(monkeypatch):
    monkeypatch.setenv(
        "API_KEYS", json.dumps({QUERY_API_KEY: {"tenant": "query-e2e-tenant", "role": "user"}})
    )
    embedder = FakeEmbedder(app_module.vector_store.dim)
    llm = FakeLLM()
    app_module.ingestion_pipeline.embedder = embedder
    app_module.retriever.embedder = embedder
    app_module.llm_client = llm
    app_module.vector_store.ensure_collection()
    app_module.ingestion_pipeline.ingest_text(
        title="Query Fixture",
        text="Qdrant is a vector database used for dense similarity search.",
        source="query_fixture.md",
        tenant_id="query-e2e-tenant",
    )
    app_module.retriever.update_chunks(app_module.vector_store.get_all_chunks())
    app_module.agent_graph = build_rag_agent_graph(
        retriever=app_module.retriever,
        graph_store=app_module.graph_store,
        llm_client=llm,
        llm_config_getter=app_module._resolve_active_llm_config_with_secrets,
        min_dense_score=0.99,
        verify_mode="citations",
    )
    client = TestClient(app_module.app)
    resp = client.post(
        "/v1/query",
        headers=HEADERS,
        json={"query": "What is the production Qdrant password?", "top_k": 3, "max_cycles": 1},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["answer_status"] == "insufficient_context"
    assert data["verified"] is False
    assert data["cycle_count"] == 1
    assert data["verification"]["status"] == "unchecked"
    assert llm.calls == []


def test_query_requires_auth():
    client = TestClient(app_module.app)
    resp = client.post("/v1/query", json={"query": "What is Qdrant?", "top_k": 3})
    assert resp.status_code == 401
