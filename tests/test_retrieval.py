"""TDD Tests for Hybrid Retrieval (BM25 + Dense Qdrant + RRF) and Cross-Encoder Reranker."""

import pytest

from packages.core.models import Chunk
from services.ingestion.vector_store import VectorStoreManager
from services.rag_engine.retrieval.bm25 import BM25Index
from services.rag_engine.retrieval.fusion import reciprocal_rank_fusion
from services.rag_engine.retrieval.hybrid import HybridRetriever
from services.rag_engine.retrieval.reranker import CrossEncoderReranker


@pytest.fixture
def sample_chunks():
    return [
        Chunk(
            id="c1",
            document_id="d1",
            text="The API Gateway uses LiteLLM proxy for load balancing across OpenAI and Anthropic.",
            section_heading="Gateway",
        ),
        Chunk(
            id="c2",
            document_id="d1",
            text="Qdrant vector database is paired with Neo4j knowledge graph for dual-memory retrieval.",
            section_heading="Storage",
        ),
        Chunk(
            id="c3",
            document_id="d2",
            text="Error code ERR-4049 occurs when API token bucket rate limit is exceeded.",
            section_heading="Troubleshooting",
        ),
        Chunk(
            id="c4",
            document_id="d2",
            text="DeepEval runs continuous evaluation in GitHub Actions blocking regressions.",
            section_heading="CI/CD",
        ),
    ]


def test_bm25_exact_keyword_search(sample_chunks):
    bm25 = BM25Index(sample_chunks)
    # Search exact technical term
    results = bm25.search("ERR-4049", top_k=2)
    assert len(results) > 0
    assert results[0].chunk_id == "c3"
    assert "ERR-4049" in results[0].text


def test_reciprocal_rank_fusion():
    list1 = [("c1", 0.9), ("c2", 0.8), ("c3", 0.7)]
    list2 = [("c3", 0.95), ("c1", 0.85), ("c4", 0.6)]

    fused = reciprocal_rank_fusion([list1, list2], k=60)
    # c1 and c3 appear in both lists so they should rank higher than c2 and c4
    top_ids = [item[0] for item in fused]
    assert top_ids[0] in ["c1", "c3"]
    assert top_ids[1] in ["c1", "c3"]


def test_cross_encoder_reranker(sample_chunks):
    reranker = CrossEncoderReranker()
    query = "How is dual memory handled in storage?"
    reranked = reranker.rerank(query=query, chunks=sample_chunks, top_k=2)

    assert len(reranked) == 2
    # c2 is directly about dual memory and Neo4j/Qdrant
    assert reranked[0].chunk_id == "c2"


def test_hybrid_retriever_end_to_end(sample_chunks):
    vstore = VectorStoreManager(in_memory=True)
    vstore.index_chunks(sample_chunks)

    retriever = HybridRetriever(vector_store=vstore, chunks=sample_chunks)
    results = retriever.retrieve("Which tool blocks prompt injection at the gateway?", top_k=2)

    assert len(results) > 0
    assert results[0].chunk_id == "c1"
    assert "Gateway" in results[0].text or "LiteLLM" in results[0].text
