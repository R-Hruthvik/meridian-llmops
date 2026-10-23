"""Shared pytest fixtures and environment setup for Meridian LLMOps tests."""

import os
import shutil
from pathlib import Path

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



import pytest

from services.gateway import auth
from services.rag_engine import app as app_module
from tests.fakes import FakeEmbedder, FakeLLM


@pytest.fixture(autouse=True)
def app_test_embedder(monkeypatch, tmp_path):
    """API unit tests inject a cheap embedder rather than downloading model weights."""
    # Per-test storage root prevents cross-test leakage of persisted chunks.
    storage_root = tmp_path / "meridian_test_storage"
    storage_root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("MERIDIAN_STORAGE_ROOT", str(storage_root))

    auth._rate_limits.clear()
    settings_file = Path("/tmp/meridian_test_settings.json")
    try:
        settings_file.unlink(missing_ok=True)
    except OSError:
        pass

    # Reset cached default services so per-test storage root and chunks are used.
    monkeypatch.setattr(app_module, "_default_service_cache", None)
    # Reset global consistency verdict so tests cannot depend on run order.
    monkeypatch.setattr(app_module, "_index_consistency", None)
    # Reset the singleton app's persisted state so stale services from a previous
    # test (e.g. an un-initialized embedder) cannot leak into this one.
    default_app = getattr(app_module, "app", None)
    if default_app is not None:
        for attr in ("vector_store", "graph_store", "ingestion_pipeline", "tracer",
                     "retriever", "llm_client", "input_guardrails", "output_guardrails",
                     "agent_graph", "index_consistency",
                     "runtime_llm_settings"):
            try:
                delattr(default_app.state, attr)
            except (AttributeError, KeyError):
                pass
        try:
            default_app.state.service_overrides = {}
        except (AttributeError, RuntimeError, OSError, ValueError):
            pass

    if app_module is not None:
        embedder = FakeEmbedder(app_module.vector_store.dim)
        llm = FakeLLM()
        # Reset persisted in-memory Qdrant chunks before hydrating.
        try:
            app_module.vector_store.ensure_collection()
            app_module.vector_store.clear(None)
        except (AttributeError, RuntimeError, OSError, ValueError):
            pass
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
        # Keep an empty corpus consistent so query endpoints work on fresh storage.
        try:
            from packages.core.settings import get_settings
            from services.ingestion.manifest import CHUNKER_VERSION, IndexManifest, write_manifest
            settings = get_settings()
            write_manifest(
                storage_root,
                IndexManifest(
                    embedding_model=settings.embedding_model,
                    embedding_dim=settings.qdrant_vector_dim,
                    chunker_version=CHUNKER_VERSION,
                    created_at="2026-01-01T00:00:00+00:00",
                    chunk_count=len(app_module.vector_store.get_all_chunks()),
                ),
            )
        except (AttributeError, RuntimeError, OSError, ValueError):
            pass
    yield
    auth._rate_limits.clear()
    try:
        settings_file.unlink(missing_ok=True)
    except OSError:
        pass
    monkeypatch.setattr(app_module, "_index_consistency", None)
    try:
        shutil.rmtree(storage_root, ignore_errors=True)
    except OSError:
        pass
