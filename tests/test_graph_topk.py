"""Per-request retrieval breadth (``top_k`` / ``recall_k``) via RunnableConfig configurable.

The retrieve node must honour the values a caller puts in
``config["configurable"]`` instead of a hardcoded constant, so a request can ask
for more or less context without recompiling the graph.
"""

import pytest

from packages.core.models import SearchResult
from services.ingestion.graph_store import KnowledgeGraphStore
from services.rag_engine.agent.graph import build_rag_agent_graph

CORPUS_SIZE = 8
DEFAULT_TOP_K = 3
TOP_K_MAX = 50


class _RecordingRetriever:
    """Records the k handed to ``retrieve`` and returns a fixed corpus.

    Returning a fixed corpus keeps the final-cut assertion independent of
    vector-store/BM25 recall behaviour; the value under test is how the graph
    calls the retriever and how many results it keeps.
    """

    def __init__(self, corpus_size: int = CORPUS_SIZE):
        self.calls: list[int] = []
        self.results = [
            SearchResult(
                chunk_id=f"c{i}",
                document_id="d1",
                text=f"Meridian platform chunk {i} describing gateway routing.",
                score=0.9,
                retrieval_method="test",
            )
            for i in range(corpus_size)
        ]

    def retrieve(self, query: str, top_k: int = 5) -> list[SearchResult]:
        self.calls.append(top_k)
        return self.results[:top_k]


def _base_state() -> dict:
    return {
        "query": "What does the Meridian platform use for gateway routing?",
        "current_search_query": "What does the Meridian platform use for gateway routing?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "critic_verdict": None,
        "cycle_count": 0,
        # max_cycles=1 guarantees the retrieve node runs exactly once, so the
        # recorded k and the cut length are unambiguous.
        "max_cycles": 1,
        "is_grounded": False,
        "is_refusal": False,
        "tenant_id": "test-tenant",
    }


async def _run(configurable: dict | None) -> tuple[_RecordingRetriever, dict]:
    retriever = _RecordingRetriever()
    graph = build_rag_agent_graph(retriever=retriever, graph_store=KnowledgeGraphStore(in_memory=True))
    config = {"configurable": {"thread_id": "t-topk", **(configurable or {})}}
    final_state = await graph.ainvoke(_base_state(), config=config)
    return retriever, final_state


@pytest.mark.asyncio
async def test_defaults_when_no_configurable_given():
    retriever, final_state = await _run(None)

    assert retriever.calls == [DEFAULT_TOP_K * 10]
    assert len(final_state["retrieved_chunks"]) == DEFAULT_TOP_K


@pytest.mark.asyncio
@pytest.mark.parametrize("top_k", [1, 2, 5, 8])
async def test_explicit_top_k_is_honoured(top_k):
    retriever, final_state = await _run({"top_k": top_k})

    assert retriever.calls == [top_k * 10]
    assert len(final_state["retrieved_chunks"]) == top_k


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_top_k", [0, -5, "abc", None, [], 2.5])
async def test_invalid_top_k_falls_back_to_default(bad_top_k):
    retriever, final_state = await _run({"top_k": bad_top_k})

    assert retriever.calls == [DEFAULT_TOP_K * 10]
    assert len(final_state["retrieved_chunks"]) == DEFAULT_TOP_K


@pytest.mark.asyncio
async def test_top_k_above_max_is_clamped():
    retriever, final_state = await _run({"top_k": 5000})

    assert retriever.calls == [TOP_K_MAX * 10]
    assert len(final_state["retrieved_chunks"]) == CORPUS_SIZE


@pytest.mark.asyncio
async def test_explicit_recall_k_is_respected():
    retriever, final_state = await _run({"top_k": 2, "recall_k": 7})

    assert retriever.calls == [7]
    assert len(final_state["retrieved_chunks"]) == 2


@pytest.mark.asyncio
async def test_recall_k_is_derived_from_top_k_when_omitted():
    retriever, final_state = await _run({"top_k": 4})

    assert retriever.calls == [40]
    assert len(final_state["retrieved_chunks"]) == 4


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_recall_k", [0, -3, "nope", None])
async def test_invalid_recall_k_is_derived_from_top_k(bad_recall_k):
    retriever, final_state = await _run({"top_k": 2, "recall_k": bad_recall_k})

    assert retriever.calls == [20]
    assert len(final_state["retrieved_chunks"]) == 2


@pytest.mark.asyncio
async def test_recall_k_never_narrows_below_top_k():
    retriever, final_state = await _run({"top_k": 5, "recall_k": 1})

    assert retriever.calls == [5]
    assert len(final_state["retrieved_chunks"]) == 5
