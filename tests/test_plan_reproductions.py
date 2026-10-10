"""Historical Phase 0 probes from MERIDIAN_FIX_AND_IMPLEMENTATION_PLAN.md."""

import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from services.ingestion.vector_store import _qdrant_point_id
from services.rag_engine.agent.critic import CriticAgent
from services.rag_engine.app import app

ROOT = Path(__file__).parents[1]


@pytest.mark.xfail(strict=True, reason="Current CRC32 vectors are deterministic; old randomized-hash claim is stale.")
def test_f01_old_hash_vectors_differ_between_processes():
    script = ROOT / "scripts/repro/repro_f01_hash_embedding.py"
    output = subprocess.check_output([sys.executable, str(script)], cwd=ROOT, text=True)
    assert json.loads(output)["same_across_processes"] is False


@pytest.mark.xfail(strict=True, reason="Legacy chunk IDs are normalized to Qdrant UUIDs in current code.")
def test_f03_old_chunk_id_is_used_directly_as_qdrant_id():
    legacy_id = "doc-00000000-0000-0000-0000-000000000001-chunk-0"
    assert _qdrant_point_id(legacy_id) == legacy_id


@pytest.mark.xfail(strict=True, reason="Current /v1/ingest accepts JSON text; multipart upload is not wired.")
def test_f08_multipart_file_upload_is_accepted():
    response = TestClient(app).post(
        "/v1/ingest", headers={"X-API-Key": "meridian-test-secret-key-2026"},
        files={"file": ("sample.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert response.status_code == 200


@pytest.mark.xfail(strict=True, reason="Provider failure still routes through refusal instead of a provider-error response.")
@pytest.mark.asyncio
async def test_f11_provider_failure_is_not_returned_as_refusal(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    from packages.core.models import Chunk
    from services.ingestion.graph_store import KnowledgeGraphStore
    from services.ingestion.vector_store import VectorStoreManager
    from services.rag_engine.agent.graph import build_rag_agent_graph
    from services.rag_engine.retrieval.hybrid import HybridRetriever
    from tests.fakes import FakeEmbedder

    chunks = [Chunk(id="repro", document_id="repro", text="Meridian uses LiteLLM for gateway routing.")]
    vector_store = VectorStoreManager(in_memory=True, embedder=FakeEmbedder())
    vector_store.index_chunks(chunks)
    retriever = HybridRetriever(vector_store=vector_store, chunks=chunks)
    graph_store = KnowledgeGraphStore(in_memory=True)

    class FailingClient:
        async def chat_completion(self, **kwargs):
            raise RuntimeError("repro provider failure")

    graph = build_rag_agent_graph(retriever, graph_store, llm_client=FailingClient())
    state = await graph.ainvoke({
        "query": "What does Meridian use for gateway routing?",
        "current_search_query": "What does Meridian use for gateway routing?",
        "retrieved_chunks": [], "entities": [], "draft_answer": "", "critic_verdict": None,
        "cycle_count": 0, "max_cycles": 1, "is_grounded": False, "is_refusal": False,
        "tenant_id": "repro",
    })
    assert state["is_refusal"] is False


@pytest.mark.xfail(strict=True, reason="Lexical overlap currently accepts the contradictory statement.")
def test_f13_contradictory_statement_is_rejected():
    verdict = CriticAgent().evaluate(
        "What is Qdrant?", "Qdrant is not a vector database used to store embeddings.",
        "Qdrant is a vector database used to store embeddings.",
    )
    assert verdict.is_grounded is False
