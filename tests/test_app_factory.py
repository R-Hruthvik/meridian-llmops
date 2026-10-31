"""The app factory keeps service state isolated between FastAPI instances."""

from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from packages.core.settings import Settings
from services.rag_engine import app as app_module


class FakeVectorStore:
    def __init__(self):
        self.ready = False

    def ensure_collection(self):
        self.ready = True

    def get_all_chunks(self, tenant_id=None):
        return []

    def count(self, tenant_id=None):
        return getattr(self, "count_value", 0)

    def health(self):
        return {"status": "ready"}


class FakePipeline:
    def __init__(self):
        self.embedder = object()
        self.storage = self

    def load_persisted_knowledge_base(self):
        return 0

    def load_all_chunks(self):
        return []

    def get_documents(self, tenant_id=None):
        return getattr(self, "documents", [])


class FakeRetriever:
    def __init__(self):
        self.embedder = None
        self.reranker = None

    def update_chunks(self, chunks):
        self.chunks = chunks

    def retrieve(
        self, query, top_k, tenant_id=None, debug=False, flagged_chunk_ids=None, session_id=None
    ):
        return SimpleNamespace(query=query, top_k=top_k, chunks=[], timings_ms={})


class FakeGraph:
    pass


class FakeTracer:
    pass


class FakeLLM:
    pass


class FakeGuardrails:
    pass


def fake_overrides():
    return {
        "vector_store": FakeVectorStore(),
        "graph_store": FakeGraph(),
        "ingestion_pipeline": FakePipeline(),
        "tracer": FakeTracer(),
        "retriever": FakeRetriever(),
        "llm_client": FakeLLM(),
        "input_guardrails": FakeGuardrails(),
        "output_guardrails": FakeGuardrails(),
        "agent_graph": object(),
        "runtime_llm_settings": {},
        "index_consistency": SimpleNamespace(ok=True, reasons=[]),
        "service_status": {},
    }


def test_api_module_preserves_route_and_state_exports():
    expected = (
        "health_live",
        "get_metrics",
        "query_endpoint",
        "delete_document_endpoint",
        "get_llm_settings",
        "_default_service_cache",
        "_default_runtime_settings",
        "validate_provider_url",
        "ProviderURLNotAllowed",
        "load_secrets",
        "save_secrets",
    )

    assert all(hasattr(app_module, name) for name in expected)


def test_default_service_cache_can_be_reset_through_api_compatibility_name(monkeypatch):
    sentinel = {"service": object()}
    monkeypatch.setattr(app_module, "_default_service_cache", None)
    monkeypatch.setattr(app_module, "_core_get_settings", lambda: "test-settings")
    monkeypatch.setattr(app_module, "_build_services", lambda settings: sentinel)

    assert app_module._default_services() is sentinel
    assert app_module._default_service_cache is sentinel


def test_create_app_uses_per_instance_settings_and_overrides(monkeypatch):
    monkeypatch.setattr(app_module, "validate_auth_configuration", lambda: None)
    monkeypatch.setattr(app_module, "_validate_production", lambda settings: None)

    async def no_db():
        return None

    monkeypatch.setattr(app_module, "init_db", no_db)

    first_settings = Settings(_env_file=None, app_env="testing", qdrant_local_path=":memory:")
    second_settings = Settings(_env_file=None, app_env="testing", qdrant_local_path=":memory:")
    first_services, second_services = fake_overrides(), fake_overrides()
    first = app_module.create_app(first_settings, first_services)
    second = app_module.create_app(second_settings, second_services)

    assert first.state.settings is first_settings
    assert first.state.service_overrides["vector_store"] is first_services["vector_store"]
    assert second.state.service_overrides["vector_store"] is second_services["vector_store"]
    assert (
        first.state.service_overrides["vector_store"]
        is not second.state.service_overrides["vector_store"]
    )

    with TestClient(first) as client:
        assert client.get("/health/live").status_code == 200
    with TestClient(second):
        pass
    assert first_services["vector_store"].ready
    assert second_services["vector_store"].ready
    assert first.state.vector_store is first_services["vector_store"]
    assert second.state.vector_store is second_services["vector_store"]


def test_create_app_builds_default_services_per_instance(monkeypatch):
    monkeypatch.setattr(app_module, "validate_auth_configuration", lambda: None)
    monkeypatch.setattr(app_module, "_validate_production", lambda settings: None)

    async def no_startup(application, settings):
        return None

    monkeypatch.setattr(app_module, "_startup", no_startup)
    built_services = [fake_overrides(), fake_overrides()]
    monkeypatch.setattr(app_module, "_build_services", lambda settings: built_services.pop(0))
    first = app_module.create_app(
        Settings(_env_file=None, app_env="testing", qdrant_local_path=":memory:"),
        {"runtime_llm_settings": {}},
    )
    second = app_module.create_app(
        Settings(_env_file=None, app_env="testing", qdrant_local_path=":memory:"),
        {"runtime_llm_settings": {}},
    )

    with TestClient(first), TestClient(second):
        assert first.state.vector_store is not second.state.vector_store


def test_app_consistency_status_and_services_are_isolated(monkeypatch):
    monkeypatch.setenv(
        "API_KEYS",
        '{"factory-user":{"tenant":"default","role":"user"}}',
    )
    monkeypatch.setattr(app_module, "validate_auth_configuration", lambda: None)
    monkeypatch.setattr(app_module, "_validate_production", lambda settings: None)

    async def no_db():
        return None

    monkeypatch.setattr(app_module, "init_db", no_db)
    first_services, second_services = fake_overrides(), fake_overrides()
    first_services["service_status"] = {
        "qdrant": {"origin": "first app", "reachable": True, "endpoint": "fake"}
    }
    first_services["index_consistency"] = SimpleNamespace(ok=True, reasons=[])
    first_services["vector_store"].count_value = 3
    first_services["ingestion_pipeline"].documents = ["first", "second"]
    second_services["service_status"] = {
        "qdrant": {"origin": "second app", "reachable": False, "endpoint": "fake"}
    }
    second_services["index_consistency"] = SimpleNamespace(
        ok=False, reasons=["second index mismatch"]
    )
    second_services["vector_store"].count_value = 9
    second_services["ingestion_pipeline"].documents = ["other"]

    first = app_module.create_app(
        Settings(_env_file=None, app_env="testing", qdrant_local_path=":memory:"),
        first_services,
    )
    second = app_module.create_app(
        Settings(_env_file=None, app_env="testing", qdrant_local_path=":memory:"),
        second_services,
    )
    headers = {"X-API-Key": "factory-user"}

    with TestClient(first) as first_client, TestClient(second) as second_client:
        first_health = first_client.get("/health", headers=headers).json()
        second_health = second_client.get("/health", headers=headers).json()
        assert first_health["services"]["qdrant"]["origin"] == "first app"
        assert second_health["services"]["qdrant"]["origin"] == "second app"
        assert (first_health["storage_documents"], first_health["vector_chunks"]) == (2, 3)
        assert (second_health["storage_documents"], second_health["vector_chunks"]) == (1, 9)
        assert (
            first_client.post(
                "/v1/retrieve", headers=headers, json={"query": "one", "top_k": 1}
            ).status_code
            == 200
        )
        blocked = second_client.post(
            "/v1/retrieve", headers=headers, json={"query": "two", "top_k": 1}
        )
        assert blocked.status_code == 503
        assert blocked.json()["error"]["reasons"] == ["second index mismatch"]

    assert first.state.index_consistency.ok is True
    assert second.state.index_consistency.ok is False


def test_fresh_import_does_not_touch_services_filesystem_or_network():
    """Importing the ASGI module only declares routes and the factory."""
    import os
    import subprocess
    import sys
    import textwrap

    script = textwrap.dedent(
        """
        import builtins
        from pathlib import Path
        from unittest.mock import patch
        import httpx
        import qdrant_client
        from services.ingestion import embedder, graph_store, pipeline, vector_store
        from services.gateway import client
        from services.gateway.guardrails import input_rails, output_rails
        from services.rag_engine.observability import langfuse_client
        from services.rag_engine.retrieval import hybrid
        from services.rag_engine.agent import graph

        def blocked(*args, **kwargs):
            raise AssertionError("import performed initialization")

        patches = [
            patch.object(qdrant_client, "QdrantClient", side_effect=blocked),
            patch.object(embedder, "FastEmbedEmbedder", side_effect=blocked),
            patch.object(graph_store, "KnowledgeGraphStore", side_effect=blocked),
            patch.object(pipeline, "IngestionPipeline", side_effect=blocked),
            patch.object(vector_store, "QdrantChunkStore", side_effect=blocked),
            patch.object(client, "LiteLLMClient", side_effect=blocked),
            patch.object(input_rails, "InputGuardrails", side_effect=blocked),
            patch.object(output_rails, "OutputGuardrails", side_effect=blocked),
            patch.object(langfuse_client, "LangfuseTracer", side_effect=blocked),
            patch.object(hybrid, "HybridRetriever", side_effect=blocked),
            patch.object(graph, "build_rag_agent_graph", side_effect=blocked),
            patch.object(httpx, "Client", side_effect=blocked),
            patch.object(Path, "exists", side_effect=blocked),
            patch.object(Path, "open", side_effect=blocked),
            patch.object(builtins, "open", side_effect=blocked),
        ]
        entered = []
        try:
            for item in patches:
                entered.append(item)
                item.__enter__()
            import services.rag_engine.app as app_module
            assert app_module.app is not None
            assert callable(app_module.create_app)
        finally:
            for item in reversed(entered):
                item.__exit__(None, None, None)
        """
    )
    env = os.environ.copy()
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=str(Path(__file__).resolve().parents[1]),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
