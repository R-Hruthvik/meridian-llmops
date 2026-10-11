"""Hybrid retrieval: dense Qdrant + BM25 + RRF with payload materialization and timings."""

import pytest

from packages.core.models import Chunk
from services.rag_engine.retrieval.bm25 import BM25Index
from services.rag_engine.retrieval.fusion import reciprocal_rank_fusion
from services.rag_engine.retrieval.hybrid import HybridRetriever
from tests.fakes import FakeEmbedder, make_vector_store


@pytest.fixture
def sample_chunks():
    return [
        Chunk(
            id="c1",
            document_id="d1",
            text="The API Gateway uses LiteLLM proxy for load balancing across OpenAI and Anthropic.",
            section_heading="Gateway",
            metadata={"title": "Architecture", "filename": "architecture.md", "page_start": 2},
        ),
        Chunk(
            id="c2",
            document_id="d1",
            text="Qdrant vector database is paired with Neo4j knowledge graph for dual-memory retrieval.",
            section_heading="Storage",
            metadata={"title": "Architecture", "filename": "architecture.md", "page_start": 3},
        ),
        Chunk(
            id="c3",
            document_id="d2",
            text="Error code ERR-4049 occurs when API token bucket rate limit is exceeded.",
            section_heading="Troubleshooting",
            metadata={"title": "Runbook", "filename": "runbook.txt", "page_start": 11},
        ),
        Chunk(
            id="c4",
            document_id="d2",
            text="DeepEval runs continuous evaluation in GitHub Actions blocking regressions.",
            section_heading="CI/CD",
            metadata={"title": "Runbook", "filename": "runbook.txt", "page_start": 12},
        ),
    ]


def build_retriever(chunks, embedder=None, bm25_chunks=None):
    embedder = embedder or FakeEmbedder()
    vstore = make_vector_store(embedder)
    if chunks:
        vstore.upsert_chunks(chunks, embedder.embed_passages([c.text for c in chunks]))
    index = BM25Index(bm25_chunks if bm25_chunks is not None else chunks)
    return HybridRetriever(embedder=embedder, vector_store=vstore, bm25_index=index)


def test_rrf_math():
    dense = [("c1", 0.9), ("c2", 0.8)]
    sparse = [("c2", 5.0), ("c1", 3.0)]

    fused = reciprocal_rank_fusion(dense, sparse, k=60)
    by_id = {f.chunk_id: f for f in fused}

    assert by_id["c1"].ranks == {"dense": 1, "bm25": 2}
    assert by_id["c2"].ranks == {"dense": 2, "bm25": 1}
    assert by_id["c1"].rrf == pytest.approx(1 / 61 + 1 / 62)
    assert by_id["c1"].scores == {"dense": 0.9, "bm25": 3.0}
    # Both chunks appear in both lists, so both score above a single-list chunk.
    single = reciprocal_rank_fusion([("c3", 0.1)], [])
    assert by_id["c1"].rrf > single[0].rrf


def test_rrf_single_list_candidate_keeps_rank():
    fused = reciprocal_rank_fusion([("c1", 0.9)], [("c9", 1.0)], k=60)
    only_dense = next(f for f in fused if f.chunk_id == "c1")
    assert only_dense.ranks == {"dense": 1}
    assert only_dense.scores == {"dense": 0.9}


def test_bm25_identifier_hit(sample_chunks):
    retriever = build_retriever(sample_chunks)
    result = retriever.retrieve("ERR-4049", top_k=3)
    assert any(c.chunk_id == "c3" for c in result.chunks)


def test_hybrid_respects_top_k(sample_chunks):
    retriever = build_retriever(sample_chunks)
    assert len(retriever.retrieve("vector database", top_k=1).chunks) == 1
    assert len(retriever.retrieve("vector database", top_k=4).chunks) == 4


def test_hybrid_tenant_filter(sample_chunks):
    retriever = build_retriever(sample_chunks)
    result = retriever.retrieve("Qdrant", top_k=5, tenant_id="other-tenant")
    assert result.chunks == []


def test_dense_only_hit_materialized_from_payload(sample_chunks):
    # No BM25 corpus: dense hits must still be returned with full metadata.
    retriever = build_retriever(sample_chunks, bm25_chunks=[])
    result = retriever.retrieve("Qdrant vector database dual-memory", top_k=3)
    assert result.chunks, "dense hits must not be dropped when BM25 has no corpus"
    top = result.chunks[0]
    assert top.chunk_id == "c2"
    assert top.filename == "architecture.md"
    assert top.page_start == 3
    assert top.heading_path == "Storage"
    assert top.scores["dense"] is not None
    assert top.scores["rerank"] is None


def test_bm25_only_hit_returned_with_metadata(sample_chunks):
    # Chunk exists only in the BM25 corpus, never upserted to Qdrant.
    retriever = build_retriever([], bm25_chunks=sample_chunks)
    result = retriever.retrieve("ERR-4049 rate limit", top_k=3)
    assert [c.chunk_id for c in result.chunks][:1] == ["c3"]
    assert result.chunks[0].filename == "runbook.txt"
    assert result.chunks[0].scores["bm25"] > 0


def test_stage_timings_present(sample_chunks):
    retriever = build_retriever(sample_chunks)
    result = retriever.retrieve("gateway load balancing", top_k=2)
    timings = result.timings_ms
    for key in ("embed", "dense", "bm25", "fusion", "rerank", "total"):
        assert key in timings
    assert timings["total"] >= timings["dense"] + timings["bm25"]
    assert timings["rerank"] == 0


def test_result_chunks_are_ranked(sample_chunks):
    retriever = build_retriever(sample_chunks)
    result = retriever.retrieve("gateway", top_k=3)
    assert [c.rank for c in result.chunks] == list(range(1, len(result.chunks) + 1))
    scores = [c.scores["final"] for c in result.chunks]
    assert scores == sorted(scores, reverse=True)
