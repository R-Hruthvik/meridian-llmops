"""Restart safety: results must be identical after a process restart (S3)."""

from pathlib import Path

from qdrant_client import QdrantClient

from packages.core.settings import get_settings
from services.ingestion.embedder import FastEmbedEmbedder
from services.ingestion.pipeline import IngestionPipeline
from services.ingestion.vector_store import QdrantChunkStore
from services.rag_engine.retrieval.bm25 import BM25Index
from services.rag_engine.retrieval.hybrid import HybridRetriever

QUESTIONS = [
    "What database stores vectors for similarity search?",
    "Which system handles entity relationships?",
    "How is the gateway configured?",
]

DOCS = [
    ("Qdrant Guide", "Qdrant stores dense vectors and answers similarity queries with payload filters."),
    ("Neo4j Guide", "Neo4j stores entity relationships as a property graph with typed edges."),
    ("Gateway Guide", "The gateway routes requests and enforces rate limits per virtual key."),
]


def _build_engine(root: Path):
    settings = get_settings()
    embedder = FastEmbedEmbedder(settings.embedding_model, cache_path=settings.fastembed_cache_path)
    client = QdrantClient(path=str(root / "qdrant"))
    store = QdrantChunkStore(client, "restart_test", embedder.dim)
    store.ensure_collection()
    pipeline = IngestionPipeline(vector_store=store, embedder=embedder, storage_root=root / "storage")
    return embedder, client, store, pipeline


def _run_queries(engine) -> list[list[tuple[str, float]]]:
    embedder, _client, store, _pipeline = engine
    retriever = HybridRetriever(
        embedder=embedder, vector_store=store, bm25_index=BM25Index(store.get_all_chunks(None))
    )
    return [
        [(chunk.chunk_id, chunk.scores["final"]) for chunk in retriever.retrieve(q, top_k=5).chunks]
        for q in QUESTIONS
    ]


def test_restart_persistence_identical_results(tmp_path):
    engine_a = _build_engine(tmp_path)
    _embedder_a, _client_a, _store_a, pipeline_a = engine_a
    for title, text in DOCS:
        pipeline_a.ingest_text(text=text, title=title, source=f"{title}.md")
    before = _run_queries(engine_a)

    # Simulate a restart: brand-new embedder, client, store and pipeline over the
    # same on-disk Qdrant path and storage directory.
    engine_a[1].close()
    engine_b = _build_engine(tmp_path)
    after = _run_queries(engine_b)

    assert len(before) == len(after)
    for question, (run_a, run_b) in zip(QUESTIONS, zip(before, after, strict=True), strict=True):
        assert [chunk_id for chunk_id, _ in run_a] == [chunk_id for chunk_id, _ in run_b], question
        for (_, score_a), (_, score_b) in zip(run_a, run_b, strict=True):
            assert abs(score_a - score_b) < 1e-5, question
    engine_b[1].close()
