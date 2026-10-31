"""End-to-end /v1/query coverage driven by the golden question set."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from services.rag_engine import app as app_module
from services.rag_engine.agent.graph import build_rag_agent_graph
from tests.fakes import FakeEmbedder, FakeLLM

GOLDEN_PATH = Path(__file__).resolve().parent / "data" / "golden_queries.json"
QUERY_API_KEY = "golden-query-key"
HEADERS = {"X-API-Key": QUERY_API_KEY, "X-Tenant-Id": "golden-query-tenant"}


@pytest.fixture
def seeded_golden_client(monkeypatch):
    monkeypatch.setenv(
        "API_KEYS", json.dumps({QUERY_API_KEY: {"tenant": "golden-query-tenant", "role": "user"}})
    )
    embedder = FakeEmbedder(app_module.vector_store.dim)
    llm = FakeLLM(content="This is supported by the provided documentation [1].")
    app_module.ingestion_pipeline.embedder = embedder
    app_module.retriever.embedder = embedder
    app_module.llm_client = llm
    app_module.vector_store.ensure_collection()
    doc_path = Path("storage/originals/default/doc-bae64cd6e192/01_fastapi_guide.md")
    app_module.ingestion_pipeline.ingest_text(
        title="FastAPI Guide",
        text=doc_path.read_text(encoding="utf-8"),
        source="01_fastapi_guide.md",
        tenant_id="golden-query-tenant",
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
    return TestClient(app_module.app), llm


def test_golden_queries_exercise_full_query_path(seeded_golden_client):
    client, llm = seeded_golden_client
    cases = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    calls_before = len(llm.calls)
    for case in cases:
        resp = client.post(
            "/v1/query",
            headers=HEADERS,
            json={
                "query": case["question"],
                "top_k": 5,
                "max_cycles": 2,
                "enforce_guardrails": True,
            },
        )
        assert resp.status_code == 200, (case["id"], resp.text)
        data = resp.json()
        assert data["query"] == case["question"]
        assert data["answer_status"] == case["expected_answer_status"], case["id"]
        assert data["verified"] is case["expected_verified"], case["id"]
        assert data["cycle_count"] == case["expected_cycle_count"], case["id"]
        assert data["verification"]["status"] == case["expected_verification_status"], case["id"]
        assert data["source_chunks"], f"{case['id']}: full pipeline must retain sources"
        assert len(data["sources"]) == len(data["source_chunks"]), case["id"]
        assert data["timings_ms"]["total"] >= 0
        if case["answerable"]:
            filenames = {chunk["filename"] for chunk in data["source_chunks"]}
            assert case["expected_doc"] in filenames, case["id"]
        else:
            assert data["verified"] is False


def test_golden_queries_compare_retrieval_and_full_pipeline(seeded_golden_client):
    client, _ = seeded_golden_client
    cases = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    for case in cases:
        retrieve_resp = client.post(
            "/v1/retrieve",
            headers=HEADERS,
            json={"query": case["question"], "top_k": 5},
        )
        query_resp = client.post(
            "/v1/query",
            headers=HEADERS,
            json={
                "query": case["question"],
                "top_k": 5,
                "max_cycles": 2,
                "enforce_guardrails": True,
            },
        )
        assert retrieve_resp.status_code == 200
        assert query_resp.status_code == 200
        retrieve_data = retrieve_resp.json()
        query_data = query_resp.json()
        if case["answerable"]:
            assert retrieve_data["chunks"], case["id"]
        assert query_data["source_chunks"], case["id"]
        assert query_data["answer_status"] == case["expected_answer_status"], case["id"]
