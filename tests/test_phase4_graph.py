from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from packages.core.models import Chunk, SearchResult
from services.ingestion.graph_store import KnowledgeGraphStore
from services.rag_engine.agent.graph import build_rag_agent_graph
from services.rag_engine.retrieval.hybrid import RankedChunk, RetrievalResult
from services.rag_engine.verification import VerificationResult, VerificationSource


class _Retriever:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int]] = []
        self.chunk = Chunk(id="c1", document_id="d1", text="Qdrant stores vectors.")

    def retrieve(self, query: str, top_k: int = 5, tenant_id: str = "default", debug: bool = False):
        self.calls.append((query, top_k))
        ranked = RankedChunk(self.chunk, 1, {"dense": 0.9, "bm25": 0.0, "final": 0.9})
        return RetrievalResult(query, top_k, [ranked], timings_ms={"total": 1.0})


def _state(max_cycles: int = 1) -> dict:
    return {
        "query": "What does Qdrant store?",
        "current_search_query": "What does Qdrant store?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": max_cycles,
        "answer_status": "answered",
        "tenant_id": "test",
        "timings_ms": {},
    }


@pytest.mark.asyncio
async def test_graph_verifies_typed_sources_and_finishes_unverified_at_attempt_limit():
    retriever = _Retriever()
    seen_sources: list[VerificationSource] = []

    async def verify(question, answer, sources, **kwargs):
        seen_sources.extend(sources)
        return VerificationResult(status="citations_failed", scope="format_and_numeric_consistency")

    graph = build_rag_agent_graph(
        retriever,
        KnowledgeGraphStore(in_memory=True),
        llm_client=SimpleNamespace(chat_completion=_completion("Qdrant stores vectors.")),
        verify_fn=verify,
        verify_mode="citations",
    )
    result = await graph.ainvoke(_state(max_cycles=1), config={"configurable": {"top_k": 1}})

    assert len(retriever.calls) == 1
    assert result["answer_status"] == "unverified"
    assert result["verification_result"].status == "citations_failed"
    assert isinstance(result["retrieved_chunks"][0], SearchResult)
    assert seen_sources == [
        VerificationSource(index=1, text="Qdrant stores vectors.", chunk_id="c1")
    ]


@pytest.mark.asyncio
async def test_final_unsupported_verdict_replaces_rejected_draft_and_keeps_sources():
    retriever = _Retriever()

    async def verify(question, answer, sources, **kwargs):
        return VerificationResult(
            status="unsupported",
            scope="llm_judgment",
            unsupported_claims=["Rejected draft claim."],
        )

    graph = build_rag_agent_graph(
        retriever,
        KnowledgeGraphStore(in_memory=True),
        llm_client=SimpleNamespace(chat_completion=_completion("Rejected draft claim.")),
        verify_fn=verify,
        verify_mode="llm",
    )
    result = await graph.ainvoke(_state(max_cycles=1), config={"configurable": {"top_k": 1}})

    assert result["answer_status"] == "refused"
    assert result["is_refusal"] is True
    assert "safely refused" in result["draft_answer"]
    assert "Rejected draft claim" not in result["draft_answer"]
    assert result["verification_result"].status == "unsupported"
    assert len(result["retrieved_chunks"]) == 1
    assert result["retrieved_chunks"][0].text == "Qdrant stores vectors."


@pytest.mark.asyncio
async def test_graph_retries_only_until_max_cycles_and_keeps_final_sources():
    retriever = _Retriever()

    async def verify(question, answer, sources, **kwargs):
        return VerificationResult(status="citations_failed", scope="format_and_numeric_consistency")

    graph = build_rag_agent_graph(
        retriever,
        KnowledgeGraphStore(in_memory=True),
        llm_client=SimpleNamespace(chat_completion=_completion("Qdrant stores vectors.")),
        verify_fn=verify,
        reformulate_fn=lambda query, **kwargs: f"standalone search: {query}",
        verify_mode="citations",
    )
    result = await graph.ainvoke(_state(max_cycles=2), config={"configurable": {"top_k": 1}})

    assert len(retriever.calls) == 2
    assert result["cycle_count"] == 2
    assert result["answer_status"] == "unverified"
    assert result["debug"]["reformulated_queries"] == ["What does Qdrant store?"]
    assert len(result["retrieved_chunks"]) == 1


@pytest.mark.asyncio
async def test_retry_without_llm_doubles_top_k_up_to_twenty():
    retriever = _Retriever()

    async def verify(question, answer, sources, **kwargs):
        return VerificationResult(status="citations_failed", scope="format_and_numeric_consistency")

    graph = build_rag_agent_graph(
        retriever,
        KnowledgeGraphStore(in_memory=True),
        llm_client=SimpleNamespace(chat_completion=_completion("Qdrant stores vectors.")),
        verify_fn=verify,
        verify_mode="citations",
    )
    await graph.ainvoke(_state(max_cycles=2), config={"configurable": {"top_k": 1}})

    assert [top_k for _, top_k in retriever.calls] == [1, 2]


@pytest.mark.asyncio
async def test_llm_reformulation_uses_active_provider_and_keeps_requested_top_k():
    retriever = _Retriever()
    calls: list[dict] = []
    completions = iter(
        ["Qdrant stores vectors.", "Qdrant vector storage", "Qdrant stores vectors."]
    )

    async def complete(**kwargs):
        calls.append(kwargs)
        return {"choices": [{"message": {"content": next(completions)}}]}

    async def verify(question, answer, sources, **kwargs):
        return VerificationResult(status="citations_failed", scope="format_and_numeric_consistency")

    graph = build_rag_agent_graph(
        retriever,
        KnowledgeGraphStore(in_memory=True),
        llm_client=SimpleNamespace(chat_completion=complete),
        llm_config_getter=lambda: {
            "provider": "custom",
            "model": "active-model",
            "api_key": "active-key",
            "base_url": "https://llm.example/v1",
        },
        verify_fn=verify,
        verify_mode="citations",
    )
    state = _state(max_cycles=2)
    state["query"] = (
        "What storage backend does Meridian use for vector embeddings and document chunks in production?"
    )
    state["current_search_query"] = state["query"]
    result = await graph.ainvoke(state, config={"configurable": {"top_k": 1}})

    assert retriever.calls[1] == ("Qdrant vector storage", 1)
    assert calls[1]["provider"] == "custom"
    assert calls[1]["model"] == "active-model"
    assert calls[1]["api_key"] == "active-key"
    rewrite_messages = calls[1]["messages"]
    assert (
        "proper nouns, numbers, product names, and error codes exactly"
        in rewrite_messages[0]["content"]
    )
    assert "2–4 likely topic keywords" in rewrite_messages[0]["content"]
    assert "Return only the query text" in rewrite_messages[0]["content"]
    assert rewrite_messages[1]["content"] == "Source question:\n" + state["query"]
    assert result["debug"]["reformulated_queries"] == ["Qdrant vector storage"]


def _completion(content: str):
    async def chat_completion(**kwargs):
        return {"choices": [{"message": {"content": content}}]}

    return chat_completion


def test_blocked_output_is_refused_and_unchecked(monkeypatch):
    from services.rag_engine import app as app_module

    class _BlockedGraph:
        async def ainvoke(self, state, config):
            return {
                "draft_answer": "You should invest all your money immediately.",
                "answer_status": "answered",
                "verification_result": VerificationResult(status="supported", scope="llm_judgment"),
                "cycle_count": 1,
                "retrieved_chunks": [],
                "entities": [],
                "timings_ms": {},
                "is_refusal": False,
            }

    monkeypatch.setattr(app_module, "agent_graph", _BlockedGraph())
    response = TestClient(app_module.app).post(
        "/v1/query",
        headers={"X-API-Key": "meridian-test-secret-key-2026"},
        json={"query": "What is in the report?", "enforce_guardrails": True},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["answer_status"] == "refused"
    assert body["refusal"] is True
    assert body["verification"]["status"] == "unchecked"
    assert body["verified"] is False
