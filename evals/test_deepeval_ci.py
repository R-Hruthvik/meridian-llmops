"""Golden dataset API behavior checks."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from services.rag_engine.app import app


@pytest.fixture
def api_client():
    return TestClient(app)


@pytest.fixture
def golden_dataset():
    dataset_path = Path(__file__).parent / "golden_dataset.json"
    with open(dataset_path, "r", encoding="utf-8") as f:
        return json.load(f)


GOLDEN_FIXTURE_DOCS = [
    {
        "title": "Meridian Dual-Memory Storage Architecture",
        "text": (
            "# Dual-Memory Layer\n"
            "Meridian uses a Dual-Memory Layer for enterprise knowledge. Dense vector "
            "embeddings are stored in Qdrant, the dedicated vector database for semantic "
            "search. Entity relationships are stored in Neo4j, the knowledge graph database "
            "for relationship traversal. Together these two databases form the primary "
            "dual-memory storage used across the platform."
        ),
    },
    {
        "title": "Meridian Gateway Prompt Injection Defense",
        "text": (
            "# Gateway Security\n"
            "The AI Gateway protects Meridian against prompt injection attacks before any "
            "data reaches an LLM provider. Input guardrails scan every incoming request and "
            "block injection attempts at the gateway boundary, keeping downstream models safe."
        ),
    },
    {
        "title": "Meridian Self-Healing Cycle Policy",
        "text": (
            "# Agentic Retry Cycles\n"
            "The LangGraph agentic engine allows a maximum of 3 total retrieval and generation "
            "attempts per query. When answer verification fails, the query is rewritten and "
            "retrieval runs again until the attempt limit is reached."
        ),
    },
]


@pytest.fixture
def seeded_golden_kb(api_client):
    """Seeds eval-owned fixture documents through the app's own ingestion path.

    Since the clean-start change (issue #23), the server boots with an empty
    knowledge base; production boot never auto-seeds. This gate is therefore
    responsible for its own fixtures: it ingests canonical docs covering the
    factual golden cases, asserts the unanswerable/adversarial behaviors on the
    empty KB, and removes the fixtures afterwards so other suites are unaffected.
    """
    headers = {"X-API-Key": "meridian-test-secret-key-2026", "X-Tenant-Id": "ci-eval-tenant"}
    doc_ids = []
    for doc in GOLDEN_FIXTURE_DOCS:
        resp = api_client.post("/v1/ingest", headers=headers, json=doc)
        assert resp.status_code == 200, f"Fixture seeding failed: {resp.text}"
        doc_ids.append(resp.json()["document_id"])

    yield api_client

    for doc_id in doc_ids:
        api_client.delete(f"/v1/documents/{doc_id}", headers=headers)


@pytest.mark.usefixtures("seeded_golden_kb")
def test_golden_dataset_returns_sources_and_consistent_verification(api_client, golden_dataset):
    """Checks golden query handling and the deprecated verified-field contract."""
    headers = {"X-API-Key": "meridian-test-secret-key-2026", "X-Tenant-Id": "ci-eval-tenant"}
    _run_golden_cases(api_client, golden_dataset, headers)


def _run_golden_cases(api_client, golden_dataset, headers):
    """Runs every golden case; unanswerable/adversarial behaviors are asserted on the KB state prepared by fixtures."""
    passed_cases = 0
    total_cases = len(golden_dataset)
    for item in golden_dataset:
        query_type = item["type"]
        query = item["query"]

        if query_type == "adversarial_injection":
            resp = api_client.post("/v1/query", headers=headers, json={"query": query})
            assert resp.status_code == 400
            assert "Prompt injection" in resp.json()["detail"]
            passed_cases += 1
            continue

        resp = api_client.post(
            "/v1/query",
            headers=headers,
            json={"query": query, "top_k": 3, "max_cycles": 3},
        )
        assert resp.status_code == 200
        data = resp.json()

        if query_type == "unanswerable_refusal":
            assert data["answer_status"] == "insufficient_context"
            assert data["verification"]["status"] == "unchecked"
            passed_cases += 1
        else:
            assert data["verified"] is (data["verification"]["status"] == "supported"), f"Failed for {item['id']}: {data}"
            assert len(data["source_chunks"]) > 0
            passed_cases += 1

    pass_rate = passed_cases / total_cases
    assert pass_rate >= 0.90, f"CI Quality Gate Failed: pass rate {pass_rate} < 0.90"
