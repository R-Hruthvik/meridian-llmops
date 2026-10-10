"""Shared pytest fixtures and environment setup for Meridian LLMOps tests."""

import os

# Set test environment variables so Settings picks them up before any imports
# that call get_settings(). These must be set before the first import of
# modules that use Settings.
os.environ.setdefault("API_KEY_SECRET", "meridian-test-secret-key-2026")
os.environ.setdefault("LITELLM_MASTER_KEY", "sk-test-litellm-key")
os.environ.setdefault("NEO4J_PASSWORD", "test-neo4j-password")
os.environ.setdefault("APP_ENV", "testing")
os.environ["VECTOR_BACKEND"] = "qdrant_local"
os.environ["QDRANT_LOCAL_PATH"] = ":memory:"


import sys

import pytest

from tests.fakes import FakeEmbedder


@pytest.fixture(autouse=True)
def app_test_embedder(monkeypatch):
    """API unit tests inject a cheap embedder rather than downloading model weights."""
    app_module = sys.modules.get('services.rag_engine.app')
    if app_module is not None:
        embedder = FakeEmbedder(app_module.vector_store.dim)
        monkeypatch.setattr(app_module.ingestion_pipeline, 'embedder', embedder)
        monkeypatch.setattr(app_module.retriever, 'embedder', embedder)
        app_module.vector_store.ensure_collection()
        if not app_module.vector_store.get_all_chunks():
            app_module.ingestion_pipeline.load_persisted_knowledge_base()
            app_module.retriever.update_chunks(app_module.vector_store.get_all_chunks())
