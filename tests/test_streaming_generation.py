"""Streaming generation: the config-injected token sink wiring in ``generate_node``."""

import asyncio

import pytest

from packages.core.models import Chunk
from services.ingestion.graph_store import KnowledgeGraphStore
from services.rag_engine.agent.graph import build_rag_agent_graph
from services.rag_engine.retrieval.hybrid import RankedChunk, RetrievalResult
from tests.fakes import FakeStreamingLLM


class _FixedRetriever:
    def __init__(self, chunk: Chunk):
        self.chunk = chunk

    def retrieve(self, query: str, top_k: int = 5, tenant_id: str = "default", debug: bool = False):
        ranked = RankedChunk(self.chunk, 1, {"dense": 0.95, "bm25": 0.0, "final": 0.95})
        return RetrievalResult(query, top_k, [ranked], timings_ms={"total": 1.0})


def _build_graph(llm: FakeStreamingLLM):
    chunk = Chunk(
        id="chunk-stream",
        document_id="doc-stream",
        text="Meridian streams answers.",
        metadata={"filename": "s.md"},
    )
    return build_rag_agent_graph(
        retriever=_FixedRetriever(chunk),
        graph_store=KnowledgeGraphStore(in_memory=True),
        llm_client=llm,
        min_dense_score=0.70,
        verify_mode="citations",
    )


def _initial_state() -> dict:
    return {
        "query": "How does Meridian stream answers?",
        "current_search_query": "How does Meridian stream answers?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": 1,
        "is_refusal": False,
        "tenant_id": "default",
        "answer_status": "answered",
        "verification_result": None,
        "timings_ms": {},
        "debug": {},
    }


@pytest.mark.asyncio
async def test_generate_node_streams_deltas_to_config_sink():
    llm = FakeStreamingLLM(["Hel", "lo ", "world"])
    graph = _build_graph(llm)
    sink: asyncio.Queue[str] = asyncio.Queue()

    result = await graph.ainvoke(
        _initial_state(),
        config={"configurable": {"top_k": 3, "token_sink": sink}},
    )

    deltas = []
    while not sink.empty():
        deltas.append(sink.get_nowait())
    assert deltas == ["Hel", "lo ", "world"]
    assert result["draft_answer"] == "Hello world"
    assert llm.stream_calls
    assert llm.unary_calls == []
