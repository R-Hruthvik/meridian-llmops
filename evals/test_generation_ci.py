"""Offline generation plumbing checks that run without provider credentials."""

import json
from pathlib import Path

import pytest

from evals.eval_generation import load_dataset
from packages.core.models import Chunk, QueryResponse
from services.ingestion.graph_store import KnowledgeGraphStore
from services.rag_engine.agent.graph import build_rag_agent_graph
from services.rag_engine.retrieval.hybrid import RankedChunk, RetrievalResult
from tests.fakes import FakeLLM


class _FixedRetriever:
    def __init__(self, chunk: Chunk | None):
        self.chunk = chunk

    def retrieve(self, query, top_k=5, tenant_id="default"):
        chunks = []
        if self.chunk is not None:
            chunks = [RankedChunk(self.chunk, 1, {"dense": 0.99, "bm25": 0.0, "final": 0.99})]
        return RetrievalResult(query, top_k, chunks, timings_ms={"total": 0.1})


def _chunk() -> Chunk:
    return Chunk(
        id="eval-chunk-1",
        document_id="eval-doc-1",
        text="FastAPI serves interactive API documentation at /docs.",
        section_heading="Documentation",
        metadata={"title": "FastAPI guide", "filename": "01_fastapi_guide.md"},
    )


def _initial_state(question: str) -> dict:
    return {
        "query": question,
        "current_search_query": question,
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": 1,
        "is_refusal": False,
        "tenant_id": "ci-eval",
    }


def test_golden_dataset_uses_current_retrieval_schema():
    dataset = load_dataset(Path(__file__).with_name("golden_dataset.json"))
    assert len(dataset) >= 50
    for case in dataset:
        assert {
            "id",
            "category",
            "question",
            "answerable",
            "expected_doc",
            "expected_phrases",
        } <= case.keys()
        assert isinstance(case["question"], str) and case["question"]
        assert isinstance(case["answerable"], bool)


def test_golden_loader_rejects_legacy_query_type_shape(tmp_path):
    dataset_path = tmp_path / "legacy.json"
    dataset_path.write_text(
        json.dumps([{"id": "old-1", "type": "factual", "query": "old question"}])
    )
    with pytest.raises(ValueError, match="golden case must include fields"):
        load_dataset(dataset_path)


@pytest.mark.asyncio
async def test_fake_llm_generation_returns_schema_valid_cited_answer():
    question = "Where does FastAPI serve its interactive API documentation?"
    fake_llm = FakeLLM(content="FastAPI serves the interactive API documentation at /docs. [1]")
    graph = build_rag_agent_graph(
        retriever=_FixedRetriever(_chunk()),
        graph_store=KnowledgeGraphStore(in_memory=True),
        llm_client=fake_llm,
        min_dense_score=0.2,
        verify_mode="citations",
    )

    final_state = await graph.ainvoke(_initial_state(question))
    response = QueryResponse(
        query=question,
        answer=final_state["draft_answer"],
        source_chunks=final_state["retrieved_chunks"],
        answer_status=final_state["answer_status"],
        verification=final_state["verification_result"].model_dump(),
    )

    assert response.answer_status == "answered"
    assert response.verification.status == "citations_ok"
    assert response.source_chunks[0].chunk_id == "eval-chunk-1"
    assert "[1]" in response.answer
    assert len(fake_llm.calls) == 1


@pytest.mark.asyncio
async def test_unanswerable_golden_case_returns_insufficient_context_without_llm_call():
    question = "What is the production Qdrant password?"
    fake_llm = FakeLLM()
    graph = build_rag_agent_graph(
        retriever=_FixedRetriever(None),
        graph_store=KnowledgeGraphStore(in_memory=True),
        llm_client=fake_llm,
        verify_mode="citations",
    )

    final_state = await graph.ainvoke(_initial_state(question))
    response = QueryResponse(
        query=question,
        answer=final_state["draft_answer"],
        source_chunks=final_state["retrieved_chunks"],
        answer_status=final_state["answer_status"],
        verification=final_state["verification_result"].model_dump(),
    )

    assert response.answer_status == "insufficient_context"
    assert response.verification.status == "unchecked"
    assert response.source_chunks == []
    assert fake_llm.calls == []
