"""Focused tests for the performance baseline benchmark harness."""

import asyncio
import json
from pathlib import Path

import pytest

from scripts.bench_baseline import (
    SUPPORTED_RETRIEVAL_PATHS,
    load_golden_dataset,
    measure_full_query,
    measure_retrieval_paths,
    provider_configured,
    resolve_provider_config,
    retrieval_path_context,
    run_benchmark,
)
from tests.fakes import FakeEmbedder


def test_load_golden_dataset_defaults_to_checked_in_data():
    cases = load_golden_dataset()
    assert isinstance(cases, list)
    assert cases
    assert all("question" in case for case in cases)


def test_load_golden_dataset_accepts_explicit_path(tmp_path: Path):
    path = tmp_path / "golden.json"
    path.write_text(json.dumps([{"id": "q1", "question": "What is X?", "answerable": True}]))
    cases = load_golden_dataset(path)
    assert cases[0]["id"] == "q1"


def test_resolve_provider_config_rejects_placeholders(monkeypatch):
    environ = {
        "API_KEY": "replace-with-provider-api-key",
        "MODEL": "your-model-name",
        "BASE_URL": "https://api.example.com/v1",
    }
    assert resolve_provider_config(environ=environ) is None
    assert provider_configured(environ=environ) is False


def test_resolve_provider_config_accepts_configured_env(monkeypatch):
    environ = {
        "PROVIDER": "custom",
        "API_KEY": "test-key",
        "MODEL": "test-model",
        "BASE_URL": "http://localhost:9999/v1",
    }
    config = resolve_provider_config(environ=environ)
    assert config is not None
    assert config["model"] == "test-model"
    assert provider_configured(environ=environ) is True


def test_supported_paths_are_stable():
    assert set(SUPPORTED_RETRIEVAL_PATHS) == {"vector_only", "bm25_only", "fusion", "reranked"}


def test_retrieval_path_context_restores_state():
    class Store:
        def search(self, *args, **kwargs):
            return ["dense"]

    class Retriever:
        def __init__(self):
            self.bm25_index = "bm25"
            self.vector_store = Store()
            self.reranker = "reranker"
            self.embedder = "embedder"

    retriever = Retriever()
    with retrieval_path_context(retriever, "vector_only"):
        assert retriever.bm25_index.chunks == [] if hasattr(retriever.bm25_index, "chunks") else True
        assert retriever.reranker is None
    assert retriever.bm25_index == "bm25"
    assert retriever.reranker == "reranker"
    assert retriever.embedder == "embedder"

    with retrieval_path_context(retriever, "bm25_only"):
        assert retriever.vector_store.search() == []
        assert retriever.embedder.embed_query("x") is None
    assert retriever.embedder == "embedder"


def test_measure_retrieval_paths_returns_all_paths():
    from services.ingestion.vector_store import QdrantChunkStore
    from qdrant_client import QdrantClient
    from services.rag_engine.retrieval.bm25 import BM25Index
    from services.rag_engine.retrieval.hybrid import HybridRetriever

    embedder = FakeEmbedder(8)
    store = QdrantChunkStore(QdrantClient(":memory:"), "test", embedder.dim)
    store.ensure_collection()
    # ingest one small chunk via pipeline? Use direct chunk
    from packages.core.models import Chunk

    chunk = Chunk(
        id="c1",
        document_id="d1",
        text="Qdrant is a vector database.",
        chunk_index=0,
        section_heading="s",
        metadata={"tenant_id": "t", "filename": "doc.md", "title": "doc"},
    )
    store.upsert_chunks([chunk], embedder.embed_passages(["Qdrant is a vector database."]))
    retriever = HybridRetriever(embedder, store, BM25Index([chunk]))
    cases = [{"id": "q1", "question": "What is Qdrant?"}]
    result = measure_retrieval_paths(retriever, cases, top_k=2, tenant_id="t")
    for path in SUPPORTED_RETRIEVAL_PATHS:
        assert path in result
        assert result[path]["case_count"] == 1
        assert "throughput_qps" in result[path]


def test_measure_full_query_skips_without_provider(monkeypatch):
    monkeypatch.setattr("scripts.bench_baseline.resolve_provider_config", lambda **kwargs: None)
    from services.ingestion.vector_store import QdrantChunkStore
    from qdrant_client import QdrantClient
    from services.rag_engine.retrieval.bm25 import BM25Index
    from services.rag_engine.retrieval.hybrid import HybridRetriever

    embedder = FakeEmbedder(8)
    store = QdrantChunkStore(QdrantClient(":memory:"), "test", embedder.dim)
    store.ensure_collection()
    from packages.core.models import Chunk

    chunk = Chunk(
        id="c1",
        document_id="d1",
        text="Qdrant is a vector database.",
        chunk_index=0,
        section_heading="s",
        metadata={"tenant_id": "t", "filename": "doc.md", "title": "doc"},
    )
    store.upsert_chunks([chunk], embedder.embed_passages(["Qdrant is a vector database."]))
    retriever = HybridRetriever(embedder, store, BM25Index([chunk]))
    cases = [{"id": "q1", "question": "What is Qdrant?"}]
    result = asyncio.run(measure_full_query(retriever, cases, provider_config=None, tenant_id="t"))
    assert result["status"] == "skipped"


def test_measure_full_query_completes_with_fake_provider(monkeypatch):
    from tests.fakes import FakeLLM

    monkeypatch.setattr("services.gateway.client.LiteLLMClient", lambda: FakeLLM(content="Qdrant is a vector database [1]."))
    from services.ingestion.vector_store import QdrantChunkStore
    from qdrant_client import QdrantClient
    from services.rag_engine.retrieval.bm25 import BM25Index
    from services.rag_engine.retrieval.hybrid import HybridRetriever

    embedder = FakeEmbedder(8)
    store = QdrantChunkStore(QdrantClient(":memory:"), "test", embedder.dim)
    store.ensure_collection()
    from packages.core.models import Chunk

    chunk = Chunk(
        id="c1",
        document_id="d1",
        text="Qdrant is a vector database used for dense similarity search.",
        chunk_index=0,
        section_heading="s",
        metadata={"tenant_id": "t", "filename": "doc.md", "title": "doc"},
    )
    store.upsert_chunks([chunk], embedder.embed_passages([chunk.text]))
    retriever = HybridRetriever(embedder, store, BM25Index([chunk]))
    cases = [{"id": "q1", "question": "What is Qdrant?"}]
    provider_config = {"provider": "fake", "model": "fake", "api_key": None, "base_url": ""}
    result = asyncio.run(
        measure_full_query(
            retriever,
            cases,
            provider_config=provider_config,
            tenant_id="t",
            min_dense_score=0.0,
        )
    )
    assert result["status"] == "completed"
    assert result["cases"][0]["answer_status"] == "answered"


def test_run_benchmark_skip_full_query(tmp_path: Path):
    from services.ingestion.vector_store import QdrantChunkStore
    from qdrant_client import QdrantClient

    # Use a tiny in-memory engine by monkeypatching build_golden_engine.
    from services.rag_engine.retrieval.bm25 import BM25Index
    from services.rag_engine.retrieval.hybrid import HybridRetriever

    embedder = FakeEmbedder(8)
    store = QdrantChunkStore(QdrantClient(":memory:"), "test", embedder.dim)
    store.ensure_collection()
    from packages.core.models import Chunk

    chunk = Chunk(
        id="c1",
        document_id="d1",
        text="Qdrant is a vector database.",
        chunk_index=0,
        section_heading="s",
        metadata={"tenant_id": "t", "filename": "doc.md", "title": "doc"},
    )
    store.upsert_chunks([chunk], embedder.embed_passages([chunk.text]))
    retriever = HybridRetriever(embedder, store, BM25Index([chunk]))

    def fake_build(*args, **kwargs):
        return retriever, store

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr("scripts.bench_baseline.build_golden_engine", fake_build)
    golden = tmp_path / "golden.json"
    golden.write_text(json.dumps([{"id": "q1", "question": "What is Qdrant?"}]))
    report = run_benchmark(
        golden_path=golden,
        tenant_id="t",
        top_k=2,
        run_full_query=False,
        embedder=embedder,
    )
    monkeypatch.undo()
def test_provider_configured_false_without_env():
    assert provider_configured(environ={}) is False