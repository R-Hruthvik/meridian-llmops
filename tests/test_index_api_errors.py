"""Index failures must reach HTTP callers with an actionable structured error."""

import pytest
from fastapi.testclient import TestClient

from services.rag_engine import app as app_module


@pytest.mark.parametrize(
    ("operation", "route", "body", "code"),
    [
        ("upsert", "/v1/ingest", {"text": "A storage failure probe."}, "index_write_error"),
        ("query_points", "/v1/query", {"query": "Where is the storage probe?"}, "index_read_error"),
    ],
)
def test_index_failure_reaches_http_caller(monkeypatch, operation, route, body, code):
    def unavailable(*args, **kwargs):
        raise OSError("Qdrant connection refused on port 6333")

    monkeypatch.setattr(app_module.vector_store.client, operation, unavailable)
    response = TestClient(app_module.app, raise_server_exceptions=False).post(
        route,
        json=body,
        headers={"X-API-Key": "meridian-test-secret-key-2026"},
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == code
    assert "Qdrant connection refused on port 6333" in response.json()["error"]["message"]
