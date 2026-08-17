"""LangGraph cyclic state machine construction."""

from typing import Any

from langgraph.graph import END, StateGraph

from services.ingestion.graph_store import KnowledgeGraphStore
from services.rag_engine.agent.critic import CriticAgent
from services.rag_engine.agent.reformulator import QueryReformulator
from services.rag_engine.agent.refusal import SafeRefusalGenerator
from services.rag_engine.agent.state import RagAgentState
from services.rag_engine.retrieval.hybrid import HybridRetriever


def build_rag_agent_graph(retriever: HybridRetriever, graph_store: KnowledgeGraphStore):
    """Assembles and compiles the cyclic LangGraph RAG workflow."""
    critic = CriticAgent()
    reformulator = QueryReformulator()
    refusal_gen = SafeRefusalGenerator()

    # --- Node Definitions ---

    def retrieve_node(state: RagAgentState) -> dict[str, Any]:
        query = state.get("current_search_query") or state["query"]
        cycle = state.get("cycle_count", 0) + 1

        chunks = retriever.retrieve(query, top_k=3)
        chunk_dicts = [c.model_dump() for c in chunks]

        # Extract graph neighborhood if entities match
        extracted_entities: list[dict[str, Any]] = []
        for word in query.split():
            relations = graph_store.query_neighborhood(word)
            for r in relations:
                extracted_entities.append(r.model_dump())

        return {
            "retrieved_chunks": chunk_dicts,
            "entities": extracted_entities,
            "cycle_count": cycle,
        }

    def generate_node(state: RagAgentState) -> dict[str, Any]:
        chunks = state.get("retrieved_chunks", [])
        valid_chunks = [c for c in chunks if c.get("score", 0) >= 0.15]
        if not valid_chunks:
            # No meaningful context retrieved
            return {
                "draft_answer": "",
            }

        context_text = "\n".join([c.get("text", "") for c in valid_chunks])
        # Deterministic factual synthesis
        draft = f"Based on the knowledge base: {context_text.strip()}"
        return {"draft_answer": draft}

    def critic_node(state: RagAgentState) -> dict[str, Any]:
        query = state["query"]
        draft = state.get("draft_answer", "")
        chunks = state.get("retrieved_chunks", [])
        valid_chunks = [c for c in chunks if c.get("score", 0) >= 0.15]
        context = "\n".join([c.get("text", "") for c in valid_chunks])

        verdict = critic.evaluate(query=query, draft=draft, context=context)
        return {
            "critic_verdict": verdict.model_dump(),
            "is_grounded": verdict.is_grounded,
        }

    def reformulate_node(state: RagAgentState) -> dict[str, Any]:
        cycle = state.get("cycle_count", 1)
        new_query = reformulator.reformulate(state["query"], cycle)
        return {"current_search_query": new_query}

    def refusal_node(state: RagAgentState) -> dict[str, Any]:
        refusal_text = refusal_gen.generate(state["query"])
        return {
            "draft_answer": refusal_text,
            "is_refusal": True,
            "is_grounded": False,
        }

    # --- Routing Condition ---

    def route_after_critique(state: RagAgentState) -> str:
        if state.get("is_grounded", False):
            return "end"

        # If not grounded, check cycle limit
        if state.get("cycle_count", 0) >= state.get("max_cycles", 3):
            return "refuse"

        return "reformulate"

    # --- Build Graph ---

    workflow = StateGraph(RagAgentState)

    workflow.add_node("retrieve", retrieve_node)
    workflow.add_node("generate", generate_node)
    workflow.add_node("critique", critic_node)
    workflow.add_node("reformulate", reformulate_node)
    workflow.add_node("refuse", refusal_node)

    workflow.set_entry_point("retrieve")
    workflow.add_edge("retrieve", "generate")
    workflow.add_edge("generate", "critique")

    workflow.add_conditional_edges(
        "critique",
        route_after_critique,
        {
            "end": END,
            "reformulate": "reformulate",
            "refuse": "refuse",
        },
    )

    workflow.add_edge("reformulate", "retrieve")
    workflow.add_edge("refuse", END)

    return workflow.compile()
