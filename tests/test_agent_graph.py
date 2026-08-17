"""TDD Tests for Self-Healing LangGraph Cyclic Agent State Machine."""

import pytest

from packages.core.models import Chunk
from services.ingestion.graph_store import KnowledgeGraphStore
from services.ingestion.vector_store import VectorStoreManager
from services.rag_engine.agent.critic import CriticAgent
from services.rag_engine.agent.graph import build_rag_agent_graph
from services.rag_engine.retrieval.hybrid import HybridRetriever


@pytest.fixture
def populated_retriever_and_graph():
    chunks = [
        Chunk(
            id="c1",
            document_id="d1",
            text="Meridian platform uses LiteLLM proxy for gateway routing and rate limiting.",
            section_heading="Gateway",
        ),
        Chunk(
            id="c2",
            document_id="d1",
            text="Qdrant provides vector search while Neo4j maintains entity relationships.",
            section_heading="Storage",
        ),
    ]
    vstore = VectorStoreManager(in_memory=True)
    vstore.index_chunks(chunks)

    gstore = KnowledgeGraphStore(in_memory=True)
    gstore.extract_and_store("d1", "LiteLLM connects to Qdrant. Neo4j stores relationships.")

    retriever = HybridRetriever(vector_store=vstore, chunks=chunks)
    return retriever, gstore


def test_critic_agent_evaluates_grounding():
    critic = CriticAgent()
    context = "Qdrant is a vector database written in Rust. Neo4j is a graph database."

    # Grounded statement
    grounded_draft = "According to the context, Qdrant is a Rust-based vector database and Neo4j is a graph database."
    verdict1 = critic.evaluate(query="What is Qdrant?", draft=grounded_draft, context=context)
    assert verdict1.is_grounded is True

    # Hallucinated statement
    hallucinated_draft = "Qdrant was invented in 1985 by IBM and uses quantum computing."
    verdict2 = critic.evaluate(query="What is Qdrant?", draft=hallucinated_draft, context=context)
    assert verdict2.is_grounded is False
    assert len(verdict2.unsupported_claims) > 0


@pytest.mark.asyncio
async def test_agent_graph_successful_flow(populated_retriever_and_graph):
    retriever, gstore = populated_retriever_and_graph
    graph = build_rag_agent_graph(retriever=retriever, graph_store=gstore)

    initial_state = {
        "query": "What does Meridian platform use for gateway routing?",
        "current_search_query": "What does Meridian platform use for gateway routing?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "critic_verdict": None,
        "cycle_count": 0,
        "max_cycles": 3,
        "is_grounded": False,
        "is_refusal": False,
        "tenant_id": "test-tenant",
    }

    final_state = await graph.ainvoke(initial_state)

    assert final_state["is_grounded"] is True
    assert final_state["is_refusal"] is False
    assert "LiteLLM" in final_state["draft_answer"]
    assert len(final_state["retrieved_chunks"]) > 0


@pytest.mark.asyncio
async def test_agent_graph_self_healing_safe_refusal_when_unanswerable(populated_retriever_and_graph):
    retriever, gstore = populated_retriever_and_graph
    graph = build_rag_agent_graph(retriever=retriever, graph_store=gstore)

    # Query asking for something completely absent from knowledge base
    initial_state = {
        "query": "What was the stock price of Apple on August 12 1994?",
        "current_search_query": "What was the stock price of Apple on August 12 1994?",
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "critic_verdict": None,
        "cycle_count": 0,
        "max_cycles": 3,
        "is_grounded": False,
        "is_refusal": False,
        "tenant_id": "test-tenant",
    }

    final_state = await graph.ainvoke(initial_state)

    # After max 3 cycles of reformulation, should gracefully refuse without hallucinating
    assert final_state["is_refusal"] is True
    assert final_state["cycle_count"] >= 1
    assert "not found" in final_state["draft_answer"].lower() or "unable" in final_state["draft_answer"].lower()
