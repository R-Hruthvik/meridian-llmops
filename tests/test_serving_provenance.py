"""Issue #35: the query response must report the model that ACTUALLY served it.

The old code echoed `get_active_llm_config()` back to the user, so a proxy
(omniroute/kilo) that substituted `kilocode/kilo-auto/free` for the requested
`kilo` was reported as `gpt-4o-mini`. These tests pin three things:
  1. the upstream `model` in the SSE/JSON body is captured, not the requested one;
  2. a substitution is surfaced in the response (and logged, model name only);
  3. when no LLM served the request (greeting bypass, refusal, degraded path)
     the response says so instead of naming a model.
"""

import json as _json  # aliased: the fake HTTP client's `json` payload param shadows the name
import logging

import pytest
from fastapi.testclient import TestClient

from services.gateway.client import LiteLLMClient
from services.rag_engine.app import app, ingestion_pipeline, retriever, vector_store

API_KEY = "meridian-test-secret-key-2026"
UPSTREAM_MODEL = "kilocode/kilo-auto/free"


class _FakeResponse:
    """Minimal stand-in for httpx.Response as used by LiteLLMClient."""

    def __init__(self, body: str, status_code: int = 200):
        self.text = body
        self.status_code = status_code
        self.request = None

    def json(self):
        return _json.loads(self.text)


def _sse(chunks: list[dict]) -> str:
    lines = [f"data: {_json.dumps(c)}" for c in chunks]
    lines.append("data: [DONE]")
    return "\n\n".join(lines)


async def _call_client(monkeypatch, body: str, model: str = "kilo") -> tuple[dict, tuple]:
    """Drive a real LiteLLMClient against a canned upstream body."""
    client = LiteLLMClient()

    class _FakeHTTP:
        async def post(self, *args, **kwargs):
            return _FakeResponse(body)

    monkeypatch.setattr(client, "_get_client", lambda: _FakeHTTP())
    try:
        resp = await client.chat_completion(
            messages=[{"role": "user", "content": "hi"}],
            model=model,
            provider="custom",
            api_key="sk-secret-value-not-for-logs",
            base_url="http://localhost:20128/v1",
        )
        return resp, client.served_snapshot()
    finally:
        await client.close()


# --- 1. Upstream model capture ------------------------------------------------


@pytest.mark.asyncio
async def test_client_returns_upstream_model_from_sse_stream(monkeypatch):
    """The SSE `model` field is the truth; the requested name is not."""
    body = _sse(
        [
            {"model": "", "choices": [{"delta": {"content": "Hel"}}]},
            {"model": UPSTREAM_MODEL, "choices": [{"delta": {"content": "lo"}}]},
            {"model": "some-later-model", "choices": [{"delta": {"content": "!"}}]},
        ]
    )
    resp, snapshot = await _call_client(monkeypatch, body)
    assert resp["model"] == UPSTREAM_MODEL
    assert resp["choices"][0]["message"]["content"] == "Hello!"
    # Provenance the endpoint reads: (seq, provider, model, requested, had_content)
    assert snapshot == (1, "custom", UPSTREAM_MODEL, "kilo", True)


@pytest.mark.asyncio
async def test_client_returns_upstream_model_from_json_body(monkeypatch):
    body = _json.dumps(
        {
            "model": UPSTREAM_MODEL,
            "choices": [{"message": {"role": "assistant", "content": "hi there"}}],
            "usage": {"total_tokens": 7},
        }
    )
    resp, _snapshot = await _call_client(monkeypatch, body)
    assert resp["model"] == UPSTREAM_MODEL


@pytest.mark.asyncio
async def test_client_falls_back_to_requested_model_when_upstream_omits_it(monkeypatch):
    body = _json.dumps({"choices": [{"message": {"content": "hi there"}}]})
    resp, snapshot = await _call_client(monkeypatch, body)
    assert resp["model"] == "kilo"
    # Still recorded, so the endpoint does not mistake this for "nothing was served".
    assert snapshot == (1, "custom", "kilo", "kilo", True)


@pytest.mark.asyncio
async def test_client_records_empty_upstream_content_as_unusable(monkeypatch):
    """An empty completion must not be attributable to a serving model."""
    body = _json.dumps({"model": UPSTREAM_MODEL, "choices": [{"message": {"content": "  "}}]})
    _resp, snapshot = await _call_client(monkeypatch, body)
    assert snapshot == (1, "custom", UPSTREAM_MODEL, "kilo", False)


# --- 2 & 3. HTTP seam ---------------------------------------------------------


@pytest.fixture
def seeded_client():
    if len(ingestion_pipeline.get_documents()) == 0:
        ingestion_pipeline.ingest_text(
            title="Serving Provenance Fixture",
            text="Meridian platform uses Qdrant for dense vector similarity and Neo4j for Knowledge Graph entity relationships.",
            source="test_serving_provenance.md",
        )
        retriever.update_chunks(vector_store.get_all_chunks())
    return TestClient(app)


def _stub_upstream(monkeypatch, answer_builder, model=UPSTREAM_MODEL):
    """Serve a canned completion from the real LiteLLMClient HTTP seam."""
    from services.rag_engine import app as app_module

    class _FakeHTTP:
        async def post(self, endpoint, headers=None, json=None):
            question = ""
            for m in (json or {}).get("messages", []):
                if m.get("role") == "user":
                    question = m["content"].split("Question:")[-1].strip()
            return _FakeResponse(
                _json.dumps(
                    {
                        "model": model,
                        "choices": [{"message": {"role": "assistant", "content": answer_builder(question)}}],
                        "usage": {"total_tokens": 12},
                    }
                )
            )

    monkeypatch.setattr(app_module.llm_client, "_get_client", lambda: _FakeHTTP())


def _grounded_answer(question: str) -> str:
    """Echo retrieved context so the Critic verifies the draft as grounded."""
    chunks = retriever.retrieve(question, top_k=3)
    return " ".join(c.text for c in chunks) or "No relevant context."


def test_query_reports_upstream_model_not_config_echo(seeded_client, monkeypatch):
    """A proxy substitution must be visible in the response, not the config name."""
    from services.rag_engine import app as app_module

    _stub_upstream(monkeypatch, _grounded_answer)

    response = seeded_client.post(
        "/v1/query",
        headers={"X-API-Key": API_KEY},
        json={"query": "What storage does Meridian use for dense vector similarity?"},
    )
    assert response.status_code == 200
    data = response.json()

    # The provider that actually received the dispatch, not get_active_llm_config().
    dispatched = app_module._resolve_active_llm_config_with_secrets()
    assert data["serving_provider"] == dispatched["provider"]
    assert data["serving"]["provider"] == dispatched["provider"]

    # The model the upstream reported, not the requested name we sent.
    assert data["serving_model"] == UPSTREAM_MODEL
    assert data["serving"]["model"] == UPSTREAM_MODEL
    assert data["serving"]["fresh"] is True
    assert data["serving_model"] != app_module.get_active_llm_config()["model"]


def test_substitution_is_logged_without_secrets(seeded_client, monkeypatch, caplog):
    _stub_upstream(monkeypatch, _grounded_answer)

    with caplog.at_level(logging.WARNING, logger="meridian.rag_engine"):
        seeded_client.post(
            "/v1/query",
            headers={"X-API-Key": API_KEY},
            json={"query": "What storage does Meridian use for dense vector similarity?"},
        )
    substitution_logs = [r for r in caplog.records if "substitut" in r.getMessage().lower()]
    assert len(substitution_logs) == 1
    assert UPSTREAM_MODEL in substitution_logs[0].getMessage()
    assert "sk-secret-value-not-for-logs" not in caplog.text


def test_refusal_does_not_claim_a_model_served_it(seeded_client, monkeypatch):
    """The refusal text is generated locally, so no model served the answer."""
    _stub_upstream(monkeypatch, lambda _q: "Bananas are a fruit grown in tropical climates.")

    response = seeded_client.post(
        "/v1/query",
        headers={"X-API-Key": API_KEY},
        json={"query": "What is the secret recipe for medieval dragon potions?", "max_cycles": 1},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["refusal"] is True
    assert data["serving_model"] is None
    assert data["serving_provider"] is None
    assert data["serving"] == {"provider": None, "model": None, "fresh": False}


def test_greeting_bypass_does_not_claim_a_model_served_it(seeded_client):
    """The greeting/bypass path never calls an LLM at all."""
    response = seeded_client.post(
        "/v1/query",
        headers={"X-API-Key": API_KEY},
        json={"query": "hi"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["serving_model"] is None
    assert data["serving"] == {"provider": None, "model": None, "fresh": False}


def test_empty_upstream_completion_does_not_claim_a_model_served_it(seeded_client, monkeypatch):
    """Testing mode synthesises the draft from context, so upstream served nothing."""
    _stub_upstream(monkeypatch, lambda _q: "   ")

    response = seeded_client.post(
        "/v1/query",
        headers={"X-API-Key": API_KEY},
        json={"query": "What storage does Meridian use for dense vector similarity?"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["serving_model"] is None
    assert data["serving"] == {"provider": None, "model": None, "fresh": False}


def test_generation_failure_is_degraded_and_claims_no_serving(seeded_client, monkeypatch):
    """Outside testing mode an empty draft is a real generation failure."""
    monkeypatch.setenv("APP_ENV", "prod")
    _stub_upstream(monkeypatch, lambda _q: "   ")

    response = seeded_client.post(
        "/v1/query",
        headers={"X-API-Key": API_KEY},
        json={"query": "What storage does Meridian use for dense vector similarity?", "max_cycles": 1},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["degraded_reason"]
    assert "empty completion" in data["degraded_reason"]
    assert data["serving_model"] is None
    assert data["serving"] == {"provider": None, "model": None, "fresh": False}
