"""POST /v1/retrieve — retrieval-only endpoint with per-stage scores and timings."""

import json

import pytest
from fastapi.testclient import TestClient

from services.rag_engine.app import app

RETRIEVE_API_KEY = "retrieve-test-key"
HEADERS = {"X-API-Key": RETRIEVE_API_KEY, "X-Tenant-Id": "retrieve-tenant"}


@pytest.fixture
def seeded_retriever(monkeypatch):
    monkeypatch.setenv(
        "API_KEYS", json.dumps({RETRIEVE_API_KEY: {"tenant": "retrieve-tenant", "role": "user"}})
    )
    from services.rag_engine import app as app_module
    from tests.fakes import FakeEmbedder

    embedder = FakeEmbedder(app_module.vector_store.dim)
    app_module.ingestion_pipeline.embedder = embedder
    app_module.retriever.embedder = embedder
    app_module.vector_store.ensure_collection()
    app_module.ingestion_pipeline.ingest_text(
        title="Retrieve Fixture",
        text=(
            "Qdrant is a vector database used for dense similarity search. "
            "It stores embeddings and supports filtered payload queries. "
            "Neo4j is a graph database used for entity relationships."
        ),
        source="retrieve_fixture.md",
        tenant_id="retrieve-tenant",
    )
    app_module.retriever.update_chunks(app_module.vector_store.get_all_chunks())


@pytest.fixture
def client(seeded_retriever):
    return TestClient(app)


def test_retrieve_returns_ranked_chunks_with_scores_and_timings(client):
    resp = client.post(
        "/v1/retrieve",
        headers=HEADERS,
        json={"query": "What is Qdrant?", "top_k": 3},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["query"] == "What is Qdrant?"
    assert data["top_k"] == 3
    assert data["chunks"], "endpoint must return ranked chunks"
    first = data["chunks"][0]
    assert first["rank"] == 1
    assert first["chunk_id"]
    assert first["text"]
    assert "Qdrant" in first["text"]
    assert {"dense", "bm25", "rrf", "final", "rerank"} <= set(first["scores"])
    assert set(data["timings_ms"]) >= {"embed", "dense", "bm25", "fusion", "rerank", "total"}


def test_retrieve_respects_top_k(client):
    resp = client.post(
        "/v1/retrieve",
        headers=HEADERS,
        json={"query": "vector database embeddings", "top_k": 1},
    )
    assert resp.status_code == 200
    assert len(resp.json()["chunks"]) == 1


def test_retrieve_requires_auth():
    client = TestClient(app)
    resp = client.post("/v1/retrieve", json={"query": "What is Qdrant?", "top_k": 3})
    assert resp.status_code == 401


def test_retrieve_ignores_spoofed_tenant_header(client):
    resp = client.post(
        "/v1/retrieve",
        headers={"X-API-Key": RETRIEVE_API_KEY, "X-Tenant-Id": "other-tenant"},
        json={"query": "What is Qdrant?", "top_k": 5},
    )
    assert resp.status_code == 200
    assert resp.json()["chunks"]
