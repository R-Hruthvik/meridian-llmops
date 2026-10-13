"""Issue #35: the query response must report the model that ACTUALLY served it.

The old code echoed `get_active_llm_config()` back to the user, so a proxy
(omniroute/kilo) that substituted `kilocode/kilo-auto/free` for the requested
`kilo` was reported as `gpt-4o-mini`. These tests pin three things:
  1. the upstream `model` in the SSE/JSON body is captured, not the requested one;
  2. a substitution is surfaced in the response (and logged, model name only);
  3. when no LLM served the request (insufficient context, refusal, degraded path)
     the response says so instead of naming a model.
"""

import json as _json  # aliased: the fake HTTP client's `json` payload param shadows the name
import logging

import pytest
from fastapi.testclient import TestClient

from services.gateway.client import LiteLLMClient
from services.rag_engine.app import app, retriever

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
    from packages.core.errors import ProviderError

    # Client records provenance before surfacing the typed failure.
    client = LiteLLMClient()
    class _FakeHTTP:
        async def post(self, *args, **kwargs):
            return _FakeResponse(body)
    monkeypatch.setattr(client, "_get_client", lambda: _FakeHTTP())
    with pytest.raises(ProviderError, match="empty completion"):
        await client.chat_completion([{"role": "user", "content": "hi"}], model="kilo", provider="custom", api_key="test-api-key", base_url="http://localhost:20128/v1")
    snapshot = client.served_snapshot()
    assert snapshot == (1, "custom", UPSTREAM_MODEL, "kilo", False)


# --- 2 & 3. HTTP seam ---------------------------------------------------------


@pytest.fixture
def seeded_client(monkeypatch, tmp_path):
    from packages.core.settings import Settings
    from services.ingestion.graph_store import KnowledgeGraphStore
    from services.ingestion.pipeline import IngestionPipeline
    from services.rag_engine import app as app_module
    from services.rag_engine.agent.graph import build_rag_agent_graph
    from services.rag_engine.retrieval.bm25 import BM25Index
    from services.rag_engine.retrieval.hybrid import HybridRetriever
    from tests.fakes import FakeEmbedder, make_vector_store

    settings = Settings(
        _env_file=None,
        provider="custom",
        api_key="test-provider-key",
        base_url="http://localhost:20128/v1",
        model="test-model",
    )
    monkeypatch.setattr(app_module, "_core_get_settings", lambda: settings)

    # Provenance tests own their corpus; earlier API tests persist unrelated documents.
    embedder = FakeEmbedder(384)
    store = make_vector_store(embedder)
    graph_store = KnowledgeGraphStore(in_memory=True)
    pipeline = IngestionPipeline(vector_store=store, embedder=embedder, graph_store=graph_store, storage_root=tmp_path)
    pipeline.ingest_text(
        title="Serving Provenance Fixture",
        text="Meridian platform uses Qdrant for dense vector similarity and Neo4j for Knowledge Graph entity relationships.",
        source="test_serving_provenance.md",
    )
    isolated_retriever = HybridRetriever(embedder=embedder, vector_store=store, bm25_index=BM25Index(pipeline.storage.load_all_chunks()))
    monkeypatch.setattr(app_module, "vector_store", store)
    monkeypatch.setattr(app_module, "graph_store", graph_store)
    monkeypatch.setattr(app_module, "ingestion_pipeline", pipeline)
    monkeypatch.setattr(app_module, "retriever", isolated_retriever)
    monkeypatch.setitem(globals(), "retriever", isolated_retriever)
    query_client = LiteLLMClient()
    monkeypatch.setattr(app_module, "llm_client", query_client)
    monkeypatch.setattr(app_module, "agent_graph", build_rag_agent_graph(
        retriever=isolated_retriever,
        graph_store=graph_store,
        llm_client=query_client,
        llm_config_getter=app_module._resolve_active_llm_config_with_secrets,
        min_dense_score=0.0,
        graph_enabled=app_module._core_get_settings().graph_enabled,
        debug_log_prompts=app_module._core_get_settings().debug_log_prompts,
    ))
    return TestClient(app)


def _stub_upstream(monkeypatch, answer_builder, model=UPSTREAM_MODEL):
    """Serve a canned completion from the real LiteLLMClient HTTP seam."""
    from services.rag_engine import app as app_module

    class _FakeHTTP:
        async def post(self, endpoint, headers=None, json=None):
            question = ""
            for m in (json or {}).get("messages", []):
                if m.get("role") == "user":
                    question = m["content"].split("Question:")[-1].split("\n\nSources:")[0].strip()
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
    result = retriever.retrieve(question, top_k=3)
    return " ".join(c.chunk.text for c in result.chunks) or "No relevant context."


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


def test_query_provenance_comes_from_this_provider_response(seeded_client, monkeypatch, caplog):
    _stub_upstream(monkeypatch, _grounded_answer)

    with caplog.at_level(logging.WARNING, logger="meridian.rag_engine"):
        seeded_client.post(
            "/v1/query",
            headers={"X-API-Key": API_KEY},
            json={"query": "What storage does Meridian use for dense vector similarity?"},
        )
    response = seeded_client.post(
        "/v1/query",
        headers={"X-API-Key": API_KEY},
        json={"query": "What storage does Meridian use for dense vector similarity?"},
    )
    data = response.json()
    assert data["serving_model"] == UPSTREAM_MODEL
    assert data["model"] == UPSTREAM_MODEL
    assert data["serving"]["fresh"] is True
    assert "sk-secret-value-not-for-logs" not in caplog.text


def test_insufficient_context_does_not_claim_a_model_served_it(seeded_client, monkeypatch):
    from services.rag_engine import app as app_module
    from services.rag_engine.agent.graph import build_rag_agent_graph

    settings = app_module._core_get_settings()
    monkeypatch.setattr(app_module, "agent_graph", build_rag_agent_graph(
        retriever=app_module.retriever,
        graph_store=app_module.graph_store,
        llm_client=app_module.llm_client,
        llm_config_getter=app_module._resolve_active_llm_config_with_secrets,
        min_dense_score=settings.min_dense_score,
        graph_enabled=settings.graph_enabled,
    ))
    _stub_upstream(monkeypatch, lambda _q: "Bananas are a fruit grown in tropical climates.")

    response = seeded_client.post(
        "/v1/query",
        headers={"X-API-Key": API_KEY},
        json={"query": "What is the secret recipe for medieval dragon potions?", "max_cycles": 1},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["answer_status"] == "insufficient_context"
    assert data["refusal"] is False
    assert data["serving_model"] is None
    assert data["serving_provider"] is None
    assert data["serving"] == {"provider": None, "model": None, "fresh": False}


def test_greeting_uses_the_normal_rag_path(seeded_client, monkeypatch):
    """A greeting no longer takes a special bypass around the RAG graph."""
    _stub_upstream(monkeypatch, lambda _q: "Hello there. [1]")
    response = seeded_client.post(
        "/v1/query",
        headers={"X-API-Key": API_KEY},
        json={"query": "hi"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["serving_model"] == UPSTREAM_MODEL
    assert data["serving"] == {"provider": "custom", "model": UPSTREAM_MODEL, "fresh": True}


def test_empty_upstream_completion_is_a_typed_provider_error(seeded_client, monkeypatch):
    _stub_upstream(monkeypatch, lambda _q: "   ")

    response = seeded_client.post(
        "/v1/query",
        headers={"X-API-Key": API_KEY},
        json={"query": "What storage does Meridian use for dense vector similarity?"},
    )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "provider_error"


def test_provider_failure_returns_provider_message_and_no_empty_answer(seeded_client, monkeypatch):
    monkeypatch.setenv("APP_ENV", "prod")
    _stub_upstream(monkeypatch, lambda _q: "   ")

    response = seeded_client.post(
        "/v1/query",
        headers={"X-API-Key": API_KEY},
        json={"query": "What storage does Meridian use for dense vector similarity?", "max_cycles": 1},
    )
    assert response.status_code == 502
    data = response.json()
    assert data["error"]["code"] == "provider_error"
    assert "empty completion" in data["error"]["message"]


def test_typed_provider_error_is_returned_as_http_json(seeded_client, monkeypatch):
    from packages.core.errors import ProviderError
    from services.rag_engine import app as app_module
    from services.rag_engine.agent.graph import build_rag_agent_graph

    class FailingClient:
        async def chat_completion(self, **kwargs):
            raise ProviderError("custom", 502, "Provider custom returned HTTP 401", "invalid credentials")

    settings = app_module._core_get_settings()
    monkeypatch.setattr(app_module, "agent_graph", build_rag_agent_graph(
        retriever=app_module.retriever,
        graph_store=app_module.graph_store,
        llm_client=FailingClient(),
        llm_config_getter=app_module._resolve_active_llm_config_with_secrets,
        min_dense_score=0.0,
        graph_enabled=settings.graph_enabled,
    ))
    response = seeded_client.post(
        "/v1/query",
        headers={"X-API-Key": API_KEY},
        json={"query": "What storage does Meridian use for dense vector similarity?"},
    )

    assert response.status_code == 502
    assert response.json() == {
        "error": {
            "code": "provider_error",
            "message": "Provider custom returned HTTP 401",
            "provider_message": "invalid credentials",
        }
    }
