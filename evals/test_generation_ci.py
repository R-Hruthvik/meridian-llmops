"""Offline generation plumbing checks that run without provider credentials."""

import json
import sys
from pathlib import Path
from types import ModuleType

import pytest

from evals.eval_generation import _generate_cases, evaluate_with_deepeval, load_dataset
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


class _ManyChunksRetriever:
    def __init__(self, chunks):
        self.chunks = chunks

    def retrieve(self, query, top_k=5, tenant_id="default"):
        return RetrievalResult(query, top_k, self.chunks[:top_k], timings_ms={"total": 0.1})


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


@pytest.mark.asyncio
async def test_generation_eval_uses_fake_llm_and_only_scores_prompt_context():
    first = RankedChunk(_chunk(), 1, {"dense": 0.99, "bm25": 0.0, "final": 0.99})
    excluded_chunk = Chunk(
        id="eval-chunk-2",
        document_id="eval-doc-2",
        text="Unselected context. " * 1600,
        metadata={"filename": "large.txt"},
    )
    second = RankedChunk(excluded_chunk, 2, {"dense": 0.99, "bm25": 0.0, "final": 0.98})
    fake_llm = FakeLLM(content="FastAPI serves the interactive API documentation at /docs. [1]")
    rows = await _generate_cases(
        [
            {
                "id": "q-001",
                "question": "Where does FastAPI serve interactive API docs?",
                "answerable": True,
                "expected_phrases": ["/docs"],
            }
        ],
        _ManyChunksRetriever([first, second]),
        tenant_id="ci-eval",
        top_k=2,
        min_dense_score=0.7,
        provider="fake",
        model="fake-model",
        api_key="test-key",
        base_url=None,
        llm_client=fake_llm,
    )

    assert len(fake_llm.calls) == 1
    assert fake_llm.calls[0]["provider"] == "fake"
    assert rows[0]["answer_status"] == "answered"
    assert rows[0]["actual_output"].endswith("[1]")
    assert rows[0]["retrieval_context"] == [first.chunk.text]


@pytest.mark.asyncio
async def test_generation_eval_does_not_call_fake_llm_for_insufficient_context():
    irrelevant = Chunk(
        id="irrelevant",
        document_id="irrelevant-doc",
        text="Unrelated passage without terms matching the question.",
        metadata={"filename": "other.txt"},
    )
    fake_llm = FakeLLM()
    rows = await _generate_cases(
        [
            {
                "id": "q-043",
                "question": "What is the production Qdrant password?",
                "answerable": False,
                "expected_phrases": [],
            }
        ],
        _ManyChunksRetriever([RankedChunk(irrelevant, 1, {"dense": 0.1, "bm25": 0.0})]),
        tenant_id="ci-eval",
        top_k=1,
        min_dense_score=0.7,
        provider="fake",
        model="fake-model",
        api_key="test-key",
        base_url=None,
        llm_client=fake_llm,
    )

    assert rows[0]["answer_status"] == "insufficient_context"
    assert rows[0]["actual_output"].startswith("I don't have enough information")
    assert rows[0]["retrieval_context"] == []
    assert fake_llm.calls == []


def test_deepeval_report_identifies_generator_and_openai_compatible_judge(monkeypatch):
    configured_judges = []

    class FakeJudge:
        def __init__(self, **kwargs):
            self.config = kwargs
            configured_judges.append(kwargs)

    class FakeTestCase:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeMetric:
        def __init__(self, **kwargs):
            self.score = 0.9
            self.reason = "offline metric stub"

        def measure(self, test_case):
            assert test_case.actual_output

    metrics_module = ModuleType("deepeval.metrics")
    metrics_module.FaithfulnessMetric = FakeMetric
    metrics_module.AnswerRelevancyMetric = FakeMetric
    metrics_module.ContextualRecallMetric = FakeMetric
    models_module = ModuleType("deepeval.models")
    models_module.OpenAIModel = FakeJudge
    testcase_module = ModuleType("deepeval.test_case")
    testcase_module.LLMTestCase = FakeTestCase
    monkeypatch.setitem(sys.modules, "deepeval.metrics", metrics_module)
    monkeypatch.setitem(sys.modules, "deepeval.models", models_module)
    monkeypatch.setitem(sys.modules, "deepeval.test_case", testcase_module)

    report = evaluate_with_deepeval(
        [
            {
                "id": "q-001",
                "input": "question",
                "actual_output": "answer [1]",
                "expected_output": "answer",
                "answer_status": "answered",
                "retrieval_context": ["evidence"],
            }
        ],
        api_key="test-key",
        generator_provider="anthropic",
        generator_model="claude-test",
        generator_base_url="https://generator.example/v1",
        judge_model="judge-test",
        judge_base_url="https://judge.example/v1",
    )

    assert report["generator"] == {
        "provider": "anthropic",
        "model": "claude-test",
        "base_url": "https://generator.example/v1",
    }
    assert report["judge"] == {
        "provider": "openai-compatible",
        "model": "judge-test",
        "base_url": "https://judge.example/v1",
    }
    assert configured_judges == [
        {
            "model": "judge-test",
            "api_key": "test-key",
            "base_url": "https://judge.example/v1",
            "temperature": 0,
        }
    ]
