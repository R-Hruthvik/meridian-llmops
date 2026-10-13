"""The app factory keeps service state isolated between FastAPI instances."""

from pathlib import Path

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

    def count(self):
        return 0


class FakePipeline:
    def __init__(self):
        self.embedder = object()
        self.storage = self

    def load_persisted_knowledge_base(self):
        return 0

    def load_all_chunks(self):
        return []


class FakeRetriever:
    def __init__(self):
        self.embedder = None
        self.reranker = None

    def update_chunks(self, chunks):
        self.chunks = chunks


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
    }


def test_create_app_uses_per_instance_settings_and_overrides(monkeypatch):
    monkeypatch.setattr(app_module, "validate_auth_configuration", lambda: None)
    monkeypatch.setattr(app_module, "_validate_production", lambda settings: None)
    async def no_db():
        return None
    monkeypatch.setattr(app_module, "init_db", no_db)

    first_settings = Settings(app_env="testing", qdrant_local_path=":memory:")
    second_settings = Settings(app_env="testing", qdrant_local_path=":memory:")
    first_services, second_services = fake_overrides(), fake_overrides()
    first = app_module.create_app(first_settings, first_services)
    second = app_module.create_app(second_settings, second_services)

    assert first.state.settings is first_settings
    assert first.state.service_overrides["vector_store"] is first_services["vector_store"]
    assert second.state.service_overrides["vector_store"] is second_services["vector_store"]
    assert first.state.service_overrides["vector_store"] is not second.state.service_overrides["vector_store"]

    with TestClient(first) as client:
        assert client.get("/health/live").status_code == 200
    with TestClient(second):
        pass
    assert first_services["vector_store"].ready
    assert second_services["vector_store"].ready
    assert first.state.vector_store is first_services["vector_store"]
    assert second.state.vector_store is second_services["vector_store"]


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
