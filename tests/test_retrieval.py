"""Hybrid retrieval: dense Qdrant + BM25 + RRF with payload materialization and timings."""

import pytest

from packages.core.models import Chunk
from services.rag_engine.observability.langfuse_client import LocalTracer
from services.rag_engine.retrieval import bm25 as bm25_module
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


def test_bm25_reuses_tenant_index_without_changing_scores(sample_chunks, monkeypatch):
    tenant_a = sample_chunks[:2]
    mixed = [
        chunk.model_copy(update={"metadata": {**chunk.metadata, "tenant_id": "a" if i < 2 else "b"}})
        for i, chunk in enumerate(sample_chunks)
    ]
    original = bm25_module.BM25Okapi
    builds = 0

    def counted_bm25(corpus):
        nonlocal builds
        builds += 1
        return original(corpus)

    monkeypatch.setattr(bm25_module, "BM25Okapi", counted_bm25)
    index = BM25Index(mixed)
    initialized_builds = builds

    actual = index.search("API Gateway LiteLLM", top_k=3, tenant_id="a")
    assert builds == initialized_builds
    expected_model = original([bm25_module.tokenize(bm25_module.index_text(chunk)) for chunk in tenant_a])
    expected_scores = expected_model.get_scores(bm25_module.tokenize("API Gateway LiteLLM"))
    expected = sorted(
        ((chunk.id, float(score)) for chunk, score in zip(tenant_a, expected_scores, strict=True) if score > 0),
        key=lambda item: -item[1],
    )[:3]
    assert [(item.chunk_id, item.score) for item in actual] == [
        item for item in expected
    ]
    assert builds == initialized_builds
    index.search("Qdrant knowledge graph", top_k=3, tenant_id="b")
    assert builds == initialized_builds


def test_bm25_add_chunks_rebuilds_tenant_indexes(sample_chunks):
    initial = [sample_chunks[0].model_copy(update={"metadata": {**sample_chunks[0].metadata, "tenant_id": "a"}})]
    added = sample_chunks[2].model_copy(update={"metadata": {**sample_chunks[2].metadata, "tenant_id": "b"}})
    other_added = sample_chunks[3].model_copy(update={"metadata": {**sample_chunks[3].metadata, "tenant_id": "b"}})
    third_added = sample_chunks[0].model_copy(update={"metadata": {**sample_chunks[0].metadata, "tenant_id": "b"}})
    index = BM25Index(initial)

    index.add_chunks([added, other_added, third_added])

    results = index.search("ERR-4049 rate limit", top_k=1, tenant_id="b")
    assert [item.chunk_id for item in results] == [added.id]
    assert index.search("ERR-4049 rate limit", top_k=1, tenant_id="a") == []


def test_bm25_sparse_scores_match_rank_bm25_after_updates(sample_chunks):
    chunks = [
        chunk.model_copy(
            update={"metadata": {**chunk.metadata, "tenant_id": "a" if i < 2 else "b"}}
        )
        for i, chunk in enumerate(sample_chunks)
    ]
    # Identical documents exercise the legacy stable ordering for tied scores.
    tied = chunks[0].model_copy(update={"id": "c5", "text": chunks[0].text})
    chunks.append(tied)
    index = BM25Index(chunks)

    def assert_matches_reference(query, tenant_id=None):
        query_tokens = bm25_module.tokenize(query)
        selected = [
            chunk
            for chunk in index.chunks
            if tenant_id is None or chunk.metadata.get("tenant_id", "default") == tenant_id
        ]
        model = bm25_module.BM25Okapi(
            [bm25_module.tokenize(bm25_module.index_text(chunk)) for chunk in selected]
        )
        scores = model.get_scores(query_tokens)
        expected = sorted(
            ((chunk.id, float(score)) for chunk, score in zip(selected, scores, strict=True) if score > 0),
            key=lambda item: -item[1],
        )[:10]
        actual = [(item.chunk_id, item.score) for item in index.search(query, top_k=10, tenant_id=tenant_id)]
        assert [chunk_id for chunk_id, _ in actual] == [chunk_id for chunk_id, _ in expected]
        assert [score for _, score in actual] == pytest.approx([score for _, score in expected])

    for query in ("API Gateway LiteLLM", "", "unknown-term"):
        assert_matches_reference(query)
        assert_matches_reference(query, "a")
    tied_results = index.search("API Gateway LiteLLM", top_k=10)
    assert [item.chunk_id for item in tied_results[:2]] == ["c1", "c5"]

    added = sample_chunks[2].model_copy(
        update={"id": "c6", "metadata": {**sample_chunks[2].metadata, "tenant_id": "a"}}
    )
    index.add_chunks([added])
    for query in ("ERR-4049 rate limit", "API Gateway", "unknown-term"):
        assert_matches_reference(query)
        assert_matches_reference(query, "a")


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


def test_retrieval_records_named_stage_spans(sample_chunks):
    tracer = LocalTracer()
    embedder = FakeEmbedder()
    vector_store = make_vector_store(embedder)
    vector_store.upsert_chunks(sample_chunks, embedder.embed_passages([c.text for c in sample_chunks]))
    retriever = HybridRetriever(
        embedder=embedder,
        vector_store=vector_store,
        bm25_index=BM25Index(sample_chunks),
        tracer=tracer,
    )

    retriever.retrieve("gateway load balancing", top_k=2, tenant_id="tenant-a")

    names = {item["name"] for item in tracer.traces}
    assert {"embed_query", "dense_search", "bm25_search", "fusion"} <= names


def test_result_chunks_are_ranked(sample_chunks):
    retriever = build_retriever(sample_chunks)
    result = retriever.retrieve("gateway", top_k=3)
    assert [c.rank for c in result.chunks] == list(range(1, len(result.chunks) + 1))
    scores = [c.scores["final"] for c in result.chunks]
    assert scores == sorted(scores, reverse=True)
