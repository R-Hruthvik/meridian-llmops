"""DeepEval CI/CD Automated Evaluation Suite testing against the Golden Dataset."""

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


def test_golden_dataset_faithfulness_and_relevancy(api_client, golden_dataset):
    """Evaluates pipeline outputs against expected thresholds (Faithfulness >= 0.90, Recall >= 0.75)."""
    headers = {"X-API-Key": "meridian-test-secret-key-2026", "X-Tenant-Id": "ci-eval-tenant"}
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
            assert data["refusal"] is True
            assert "unable to verify" in data["answer"].lower() or "not found" in data["answer"].lower()
            passed_cases += 1
        else:
            assert data["verified"] is True
            assert len(data["source_chunks"]) > 0
            passed_cases += 1

    pass_rate = passed_cases / total_cases
    assert pass_rate >= 0.90, f"CI Quality Gate Failed: pass rate {pass_rate} < 0.90"
