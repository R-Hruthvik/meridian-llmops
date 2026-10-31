"""TDD Tests for Self-Healing LangGraph Cyclic Agent State Machine."""

import pytest

from packages.core.errors import ProviderError
from packages.core.models import Chunk
from services.ingestion.graph_store import KnowledgeGraphStore
from services.rag_engine.agent.graph import _format_graph_facts, build_rag_agent_graph
from services.rag_engine.retrieval.hybrid import HybridRetriever, RankedChunk, RetrievalResult
from services.rag_engine.verification import VerificationResult
from tests.fakes import FakeEmbedder, FakeLLM, make_vector_store


@pytest.fixture
def populated_retriever_and_graph():
    chunks = [
        Chunk(
            id="c1",
            document_id="d1",
            text="Meridian platform uses LiteLLM proxy for gateway routing and rate limiting.",
            section_heading="Gateway",
            metadata={"tenant_id": "test-tenant"},
        ),
        Chunk(
            id="c2",
            document_id="d1",
            text="Qdrant provides vector search while Neo4j maintains entity relationships.",
            section_heading="Storage",
            metadata={"tenant_id": "test-tenant"},
        ),
    ]
    embedder = FakeEmbedder()
    vstore = make_vector_store(embedder)
    vstore.upsert_chunks(chunks, embedder.embed_passages([c.text for c in chunks]))

    gstore = KnowledgeGraphStore(in_memory=True)
    gstore.extract_and_store("d1", "LiteLLM connects to Qdrant. Neo4j stores relationships.")

    from services.rag_engine.retrieval.bm25 import BM25Index

    retriever = HybridRetriever(
        embedder=embedder, vector_store=vstore, bm25_index=BM25Index(chunks)
    )
    return retriever, gstore


@pytest.mark.asyncio
async def test_unsupported_chunks_skip_generation_even_with_a_raw_bm25_hit():
    chunk = Chunk(
        id="c-noise",
        document_id="d-noise",
        text="This page describes an unrelated internal process.",
        section_heading="Operations",
        metadata={"filename": "ops.md", "page": 4},
    )

    class Retriever:
        def retrieve(self, query, top_k=5, tenant_id="default", debug=False):
            return RetrievalResult(
                query=query,
                top_k=top_k,
                chunks=[RankedChunk(chunk, 1, {"dense": 0.2, "bm25": 2.0, "final": 0.01})],
                timings_ms={"total": 1.0},
            )

    class CountingLLM:
        calls = 0

        async def chat_completion(self, **kwargs):
            self.calls += 1
            return {"choices": [{"message": {"content": "unsupported"}}]}

    client = CountingLLM()
    graph = build_rag_agent_graph(
        retriever=Retriever(),
        graph_store=KnowledgeGraphStore(in_memory=True),
        llm_client=client,
    )
    state = {
        "query": "What was the stock price of Apple in 1994?",
        "current_search_query": "What was the stock price of Apple in 1994?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": 2,
        "is_refusal": False,
        "tenant_id": "test-tenant",
    }

    result = await graph.ainvoke(state, config={"configurable": {"top_k": 1}})

    assert result["answer_status"] == "insufficient_context"
    assert (
        result["draft_answer"]
        == "I don't have enough information in the provided documents to answer that."
    )
    assert client.calls == 0
    assert result["retrieved_chunks"][0].filename == "ops.md"


@pytest.mark.asyncio
async def test_prompt_budget_dropping_all_sources_skips_generation():
    chunk = Chunk(id="c-large", document_id="d-large", text="Qdrant " * 30000)

    class Retriever:
        def retrieve(self, query, top_k=5, tenant_id="default", debug=False):
            return RetrievalResult(
                query, top_k, [RankedChunk(chunk, 1, {"dense": 0.9, "bm25": 0.0, "final": 0.01})]
            )

    client = FakeLLM()
    graph = build_rag_agent_graph(
        Retriever(), KnowledgeGraphStore(in_memory=True), llm_client=client
    )
    state = {
        "query": "What is Qdrant?",
        "current_search_query": "What is Qdrant?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": 1,
        "is_refusal": False,
        "tenant_id": "test",
    }

    result = await graph.ainvoke(state, config={"configurable": {"top_k": 1}})

    assert result["answer_status"] == "insufficient_context"
    assert client.calls == []


@pytest.mark.asyncio
async def test_prompt_sufficiency_is_rechecked_after_budget_selection():
    noise = Chunk(id="c-noise", document_id="d", text="An unrelated operations note.")
    useful_but_dropped = Chunk(
        id="c-useful", document_id="d", text="Qdrant stores vectors. " * 30000
    )

    class Retriever:
        def retrieve(self, query, top_k=5, tenant_id="default", debug=False):
            return RetrievalResult(
                query,
                top_k,
                [
                    RankedChunk(noise, 1, {"dense": 0.2, "bm25": 2.0, "final": 0.02}),
                    RankedChunk(useful_but_dropped, 2, {"dense": 0.9, "bm25": 0.0, "final": 0.01}),
                ],
            )

    client = FakeLLM()
    graph = build_rag_agent_graph(
        Retriever(), KnowledgeGraphStore(in_memory=True), llm_client=client
    )
    state = {
        "query": "What does Qdrant store?",
        "current_search_query": "What does Qdrant store?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": 1,
        "is_refusal": False,
        "tenant_id": "test",
    }

    result = await graph.ainvoke(state, config={"configurable": {"top_k": 2}})

    assert result["answer_status"] == "insufficient_context"
    assert client.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["runtime"])
async def test_generation_failures_are_typed_provider_errors(failure):
    chunk = Chunk(id="c-source", document_id="d", text="Qdrant stores vectors.")

    class Retriever:
        def retrieve(self, query, top_k=5, tenant_id="default", debug=False):
            return RetrievalResult(
                query, top_k, [RankedChunk(chunk, 1, {"dense": 0.9, "bm25": 0.0, "final": 0.01})]
            )

    class FailingClient:
        async def chat_completion(self, **kwargs):
            if failure == "runtime":
                raise RuntimeError("connection refused")
            return {"choices": [{"message": {"content": "  "}}]}

    graph = build_rag_agent_graph(
        Retriever(),
        KnowledgeGraphStore(in_memory=True),
        llm_client=FailingClient(),
        llm_config_getter=lambda: {"provider": "custom", "model": "test"},
    )
    state = {
        "query": "What does Qdrant store?",
        "current_search_query": "What does Qdrant store?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": 1,
        "is_refusal": False,
        "tenant_id": "test",
    }

    with pytest.raises(ProviderError) as error:
        await graph.ainvoke(state, config={"configurable": {"top_k": 1}})

    assert error.value.status == 502
    assert error.value.provider_message == "connection refused"


@pytest.mark.asyncio
async def test_empty_completion_returns_insufficient_context():
    chunk = Chunk(id="c-source", document_id="d", text="Qdrant stores vectors.")

    class Retriever:
        def retrieve(self, query, top_k=5, tenant_id="default", debug=False):
            return RetrievalResult(
                query, top_k, [RankedChunk(chunk, 1, {"dense": 0.9, "bm25": 0.0, "final": 0.01})]
            )

    class FailingClient:
        async def chat_completion(self, **kwargs):
            return {"choices": [{"message": {"content": "  "}}]}

    graph = build_rag_agent_graph(
        Retriever(),
        KnowledgeGraphStore(in_memory=True),
        llm_client=FailingClient(),
        llm_config_getter=lambda: {"provider": "custom", "model": "test"},
    )
    state = {
        "query": "What does Qdrant store?",
        "current_search_query": "What does Qdrant store?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": 1,
        "is_refusal": False,
        "tenant_id": "test",
    }
    final = await graph.ainvoke(state, config={"configurable": {"top_k": 1}})
    assert final.get("answer_status") == "insufficient_context"


@pytest.mark.asyncio
async def test_debug_prompt_logging_is_correlated_and_redacts_key_in_json_property(caplog):
    chunk = Chunk(id="c-safe", document_id="d-safe", text="Qdrant is a vector database.")

    class Retriever:
        def retrieve(self, query, top_k=5, tenant_id="default", debug=False):
            return RetrievalResult(
                query, top_k, [RankedChunk(chunk, 1, {"dense": 0.9, "bm25": 0.0, "final": 0.01})]
            )

    class Client:
        async def chat_completion(self, **kwargs):
            return {
                "choices": [{"message": {"content": "Qdrant is a vector database."}}],
                "raw_response": {"credential-secret": "credential-secret", "text": "ok"},
                "usage": None,
            }

    graph = build_rag_agent_graph(
        Retriever(),
        KnowledgeGraphStore(in_memory=True),
        llm_client=Client(),
        llm_config_getter=lambda: {
            "provider": "custom",
            "model": "test",
            "api_key": "credential-secret",
        },
        debug_log_prompts=True,
    )
    state = {
        "query": "What is Qdrant?",
        "current_search_query": "What is Qdrant?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": 1,
        "is_refusal": False,
        "tenant_id": "test",
        "request_id": "request-123",
    }

    with caplog.at_level("DEBUG", logger="meridian.rag_engine.agent"):
        await graph.ainvoke(state, config={"configurable": {"top_k": 1}})

    logs = "\n".join(record.getMessage() for record in caplog.records)
    assert "request_id=request-123 prompt=" in logs
    assert "<source_text>" in logs
    assert "request_id=request-123 response=" in logs
    assert "credential-secret" not in logs
    assert "[REDACTED]" in logs


@pytest.mark.asyncio
async def test_debug_prompt_logging_is_off_by_default(caplog):
    chunk = Chunk(id="c-safe", document_id="d-safe", text="Qdrant is a vector database.")

    class Retriever:
        def retrieve(self, query, top_k=5, tenant_id="default", debug=False):
            return RetrievalResult(
                query, top_k, [RankedChunk(chunk, 1, {"dense": 0.9, "bm25": 0.0, "final": 0.01})]
            )

    graph = build_rag_agent_graph(
        Retriever(),
        KnowledgeGraphStore(in_memory=True),
        llm_client=FakeLLM(),
        llm_config_getter=lambda: {"provider": "custom", "model": "test", "api_key": "test-key"},
    )
    state = {
        "query": "What is Qdrant?",
        "current_search_query": "What is Qdrant?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": 1,
        "is_refusal": False,
        "tenant_id": "test",
        "request_id": "request-disabled",
    }

    with caplog.at_level("DEBUG", logger="meridian.rag_engine.agent"):
        await graph.ainvoke(state, config={"configurable": {"top_k": 1}})

    assert "request-disabled prompt=" not in caplog.text
    assert "request-disabled response=" not in caplog.text


@pytest.mark.asyncio
async def test_max_cycles_limits_total_retrieval_attempts():
    chunk = Chunk(id="c-cycle", document_id="d-cycle", text="Qdrant stores vector embeddings.")

    class Retriever:
        calls = 0

        def retrieve(self, query, top_k=5, tenant_id="default", debug=False):
            self.calls += 1
            return RetrievalResult(
                query, top_k, [RankedChunk(chunk, 1, {"dense": 0.9, "bm25": 0.0, "final": 0.01})]
            )

    class UngroundedLLM:
        calls = 0

        async def chat_completion(self, **kwargs):
            self.calls += 1
            return {"choices": [{"message": {"content": "Paris is the capital of France."}}]}

    retriever = Retriever()
    client = UngroundedLLM()
    graph = build_rag_agent_graph(retriever, KnowledgeGraphStore(in_memory=True), llm_client=client)
    state = {
        "query": "What does Qdrant store?",
        "current_search_query": "What does Qdrant store?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": 2,
        "is_refusal": False,
        "tenant_id": "test",
    }

    result = await graph.ainvoke(state, config={"configurable": {"top_k": 1}})

    assert retriever.calls == client.calls == result["cycle_count"] == 2
    assert result["answer_status"] == "unverified"
    assert result["is_refusal"] is False


@pytest.mark.asyncio
async def test_agent_graph_successful_flow(populated_retriever_and_graph):
    retriever, gstore = populated_retriever_and_graph
    graph = build_rag_agent_graph(
        retriever=retriever,
        graph_store=gstore,
        llm_client=FakeLLM(
            content="Meridian uses LiteLLM proxy for gateway routing and rate limiting. [1]"
        ),
        min_dense_score=0.2,
    )

    initial_state = {
        "query": "What does Meridian platform use for gateway routing?",
        "current_search_query": "What does Meridian platform use for gateway routing?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": 3,
        "is_refusal": False,
        "tenant_id": "test-tenant",
    }

    final_state = await graph.ainvoke(initial_state)

    assert final_state["verification_result"].status == "citations_ok"
    assert final_state["is_refusal"] is False
    assert "LiteLLM" in final_state["draft_answer"]
    assert len(final_state["retrieved_chunks"]) > 0


@pytest.mark.asyncio
@pytest.mark.asyncio
async def test_agent_graph_self_healing_safe_refusal_when_unanswerable(
    populated_retriever_and_graph,
):
    retriever, gstore = populated_retriever_and_graph
    client = FakeLLM()
    graph = build_rag_agent_graph(retriever=retriever, graph_store=gstore, llm_client=client)

    # Query asking for something completely absent from knowledge base
    initial_state = {
        "query": "What was the stock price of Apple on August 12 1994?",
        "current_search_query": "What was the stock price of Apple on August 12 1994?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": 3,
        "is_refusal": False,
        "tenant_id": "test-tenant",
    }

    final_state = await graph.ainvoke(initial_state)

    assert final_state["answer_status"] == "insufficient_context"
    assert (
        final_state["draft_answer"]
        == "I don't have enough information in the provided documents to answer that."
    )
    assert final_state["cycle_count"] == 1
    assert client.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("graph_enabled", "context_enabled"), [(False, True), (True, False), (True, True)]
)
async def test_graph_context_is_opt_in_and_carries_retrieved_chunk_ids(
    graph_enabled, context_enabled
):
    chunk = Chunk(id="c-graph", document_id="d-graph", text="Qdrant connects to Neo4j.")

    class Retriever:
        def retrieve(self, query, top_k=5, tenant_id="default", debug=False):
            return RetrievalResult(
                query, top_k, [RankedChunk(chunk, 1, {"dense": 0.9, "bm25": 0.0, "final": 0.01})]
            )

    graph_store = KnowledgeGraphStore(in_memory=True)
    graph_store.extract_and_store("d-graph", chunk.text, chunks=[chunk])
    client = FakeLLM(content="Qdrant connects to Neo4j. [1]")

    async def verify(**kwargs):
        return VerificationResult(status="citations_ok", scope="format_and_numeric_consistency")

    graph = build_rag_agent_graph(
        Retriever(),
        graph_store,
        llm_client=client,
        graph_enabled=graph_enabled,
        graph_context_enabled=context_enabled,
        min_dense_score=0.2,
        verify_fn=verify,
    )
    await graph.ainvoke(
        {
            "query": "How does Qdrant connect?",
            "current_search_query": "How does Qdrant connect?",
            "retrieved_chunks": [],
            "entities": [],
            "draft_answer": "",
            "cycle_count": 0,
            "max_cycles": 1,
            "is_refusal": False,
            "tenant_id": "default",
        }
    )

    user_prompt = client.calls[0]["messages"][1]["content"]
    expected = graph_enabled and context_enabled
    assert ("Graph facts:" in user_prompt) is expected
    if expected:
        assert "c-graph" in user_prompt


def test_graph_fact_prompt_is_limited_to_five_grounded_edges():
    graph_context = [
        {
            "source_entity": f"Source {index}",
            "relation_type": "RELATES_TO",
            "target_entity": f"Target {index}",
            "chunk_ids": ["c-1"],
        }
        for index in range(8)
    ]

    prompt_section = _format_graph_facts(graph_context, [{"chunk_id": "c-1"}])

    assert prompt_section.startswith("\n\nGraph facts:")
    assert prompt_section.count("\n- ") == 5
    assert "Source 4" in prompt_section
    assert "Source 5" not in prompt_section
    assert "source chunk IDs: c-1" in prompt_section
