"""Two-tenant regressions for document, lexical, and graph isolation."""

import json

import pytest
from fastapi.testclient import TestClient

from packages.core.models import Chunk
from packages.core.settings import get_settings
from services.gateway import auth
from services.ingestion.graph_store import KnowledgeGraphStore
from services.ingestion.pipeline import IngestionPipeline
from services.rag_engine import app as app_module
from services.rag_engine.agent.graph import build_rag_agent_graph
from services.rag_engine.retrieval.bm25 import BM25Index
from services.rag_engine.retrieval.hybrid import HybridRetriever, RetrievalResult
from tests.fakes import FakeEmbedder, make_vector_store


@pytest.fixture
def tenant_client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_ENV", "testing")
    monkeypatch.setenv(
        "API_KEYS",
        json.dumps({
            "tenant-a-key": {"tenant": "tenant-a", "role": "user"},
            "tenant-b-key": {"tenant": "tenant-b", "role": "user"},
            "operator-key": {"tenant": "operations", "role": "admin"},
        }),
    )
    monkeypatch.setenv("ADMIN_API_KEY", "operator-key")
    get_settings.cache_clear()
    auth._rate_limits.clear()

    embedder = FakeEmbedder()
    vector_store = make_vector_store(embedder)
    pipeline = IngestionPipeline(vector_store, embedder=embedder, storage_root=tmp_path)
    retriever = HybridRetriever(embedder, vector_store)
    monkeypatch.setattr(app_module, "vector_store", vector_store)
    monkeypatch.setattr(app_module, "ingestion_pipeline", pipeline)
    monkeypatch.setattr(app_module, "retriever", retriever)
    client = TestClient(app_module.app)
    yield client, pipeline, retriever
    vector_store.client.close()
    get_settings.cache_clear()


def test_document_catalog_and_ids_are_scoped_to_api_key_tenant(tenant_client):
    client, pipeline, _ = tenant_client
    tenant_a = pipeline.ingest_text(
        "Tenant A confidential phrase.", "Tenant A", tenant_id="tenant-a"
    ).document_id
    tenant_b = pipeline.ingest_text(
        "Tenant B confidential phrase.", "Tenant B", tenant_id="tenant-b"
    ).document_id
    headers_a = {"X-API-Key": "tenant-a-key", "X-Tenant-Id": "tenant-b"}
    headers_b = {"X-API-Key": "tenant-b-key"}

    catalog_a = client.get("/v1/documents", headers=headers_a).json()
    catalog_b = client.get("/v1/documents", headers=headers_b).json()
    assert [doc["id"] for doc in catalog_a["documents"]] == [tenant_a]
    assert [doc["id"] for doc in catalog_b["documents"]] == [tenant_b]
    assert client.get(f"/v1/documents/{tenant_b}", headers=headers_a).status_code == 404
    assert client.get(f"/v1/documents/{tenant_b}/chunks", headers=headers_a).status_code == 404
    assert client.delete(f"/v1/documents/{tenant_b}", headers=headers_a).status_code == 404
    assert pipeline.get_document(tenant_b) is not None


def test_user_cannot_clear_global_documents(tenant_client):
    client, pipeline, _ = tenant_client
    pipeline.ingest_text("Tenant A data.", "Tenant A", tenant_id="tenant-a")
    pipeline.ingest_text("Tenant B data.", "Tenant B", tenant_id="tenant-b")

    response = client.delete("/v1/documents", headers={"X-API-Key": "tenant-a-key"})

    assert response.status_code == 403
    assert {doc["tenant_id"] for doc in pipeline.get_documents()} == {"tenant-a", "tenant-b"}


def test_bm25_filters_tenant_corpus_before_top_k():
    chunks = [
        Chunk(
            id=f"b-{index}", document_id=f"doc-b-{index}", text="needle " * 8,
            metadata={"tenant_id": "tenant-b"},
        )
        for index in range(25)
    ]
    chunks.append(Chunk(
        id="a-hit", document_id="doc-a", text="needle",
        metadata={"tenant_id": "tenant-a"},
    ))
    chunks.append(Chunk(
        id="a-other", document_id="doc-a", text="different terms",
        metadata={"tenant_id": "tenant-a"},
    ))
    chunks.append(Chunk(
        id="a-other-2", document_id="doc-a", text="more distinct words",
        metadata={"tenant_id": "tenant-a"},
    ))
    index = BM25Index(chunks)

    result = index.search("needle", top_k=1, tenant_id="tenant-a")

    assert [hit.chunk_id for hit in result] == ["a-hit"]


def test_graph_evidence_and_delete_are_scoped_to_tenant():
    graph = KnowledgeGraphStore(in_memory=True)
    graph.extract_and_store("doc-a", "Qdrant stores vector passage.", tenant_id="tenant-a")
    graph.extract_and_store("doc-b", "Qdrant connects to Neo4j secret evidence.", tenant_id="tenant-b")

    a_entities = graph.get_entities(tenant_id="tenant-a")
    a_neighbors = graph.query_neighborhood("Qdrant", tenant_id="tenant-a")
    graph.delete_by_document("doc-b", tenant_id="tenant-b")

    assert {entity.name for entity in a_entities} == {"Qdrant"}
    assert all("Neo4j" not in (edge.source_entity, edge.target_entity) for edge in a_neighbors)
    assert graph.get_entities(tenant_id="tenant-b") == []
    assert graph.get_entities(tenant_id="tenant-a")


@pytest.mark.asyncio
async def test_query_graph_evidence_uses_authenticated_tenant():
    graph_store = KnowledgeGraphStore(in_memory=True)
    graph_store.extract_and_store("doc-a", "Qdrant stores vector data.", tenant_id="tenant-a")
    graph_store.extract_and_store("doc-b", "Neo4j stores private graph evidence.", tenant_id="tenant-b")

    class EmptyRetriever:
        def retrieve(self, query, top_k=5, tenant_id="default", debug=False):
            return RetrievalResult(query, top_k, [], timings_ms={"total": 1.0})

    agent = build_rag_agent_graph(
        retriever=EmptyRetriever(), graph_store=graph_store, graph_enabled=True
    )
    state = {
        "query": "What does Neo4j store?",
        "current_search_query": "What does Neo4j store?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": 1,
        "is_refusal": False,
        "tenant_id": "tenant-a",
        "timings_ms": {},
    }

    result = await agent.ainvoke(state, config={"configurable": {"top_k": 1}})

    assert "Neo4j" not in {entity.name for entity in result["entities"]}


def test_index_diagnostics_are_reserved_for_platform_admin(tenant_client):
    client, _, _ = tenant_client
    assert client.get("/v1/index/status", headers={"X-API-Key": "tenant-a-key"}).status_code == 403
    assert client.get("/v1/index/status", headers={"X-API-Key": "operator-key"}).status_code == 200
