"""Shared pytest fixtures and environment setup for Meridian LLMOps tests."""

import os

# Set test environment variables so Settings picks them up before any imports
# that call get_settings(). These must be set before the first import of
# modules that use Settings.
os.environ.setdefault("API_KEY_SECRET", "meridian-test-secret-key-2026")
os.environ.setdefault("ADMIN_API_KEY", "meridian-test-admin-key-2026")
os.environ.setdefault("LITELLM_MASTER_KEY", "sk-test-litellm-key")
os.environ.setdefault("NEO4J_PASSWORD", "test-neo4j-password")
os.environ.setdefault("APP_ENV", "testing")
os.environ.setdefault("API_KEY", "")
os.environ.setdefault("BASE_URL", "")
os.environ.setdefault("MODEL", "")
os.environ.setdefault("PROVIDER", "")
os.environ["VECTOR_BACKEND"] = "qdrant_local"
os.environ["QDRANT_LOCAL_PATH"] = ":memory:"


import sys

import pytest

from services.gateway import auth
from tests.fakes import FakeEmbedder, FakeLLM


@pytest.fixture(autouse=True)
def app_test_embedder(monkeypatch):
    """API unit tests inject a cheap embedder rather than downloading model weights."""
    auth._rate_limits.clear()
    app_module = sys.modules.get('services.rag_engine.app')
    if app_module is not None:
        embedder = FakeEmbedder(app_module.vector_store.dim)
        llm = FakeLLM()
        monkeypatch.setattr(app_module, 'llm_client', llm)
        settings = app_module._core_get_settings()
        monkeypatch.setattr(app_module, 'agent_graph', app_module.build_rag_agent_graph(
            retriever=app_module.retriever,
            graph_store=app_module.graph_store,
            llm_client=llm,
            llm_config_getter=app_module._resolve_active_llm_config_with_secrets,
            min_dense_score=settings.min_dense_score,
            graph_enabled=settings.graph_enabled,
            debug_log_prompts=settings.debug_log_prompts,
        ))
        monkeypatch.setattr(app_module.ingestion_pipeline, 'embedder', embedder)
        monkeypatch.setattr(app_module.retriever, 'embedder', embedder)
        app_module.vector_store.ensure_collection()
        if not app_module.vector_store.get_all_chunks():
            app_module.ingestion_pipeline.load_persisted_knowledge_base()
            app_module.retriever.update_chunks(app_module.vector_store.get_all_chunks())
    yield
    auth._rate_limits.clear()
