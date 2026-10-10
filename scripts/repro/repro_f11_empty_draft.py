"""Show the graph behavior when the provider fails."""

import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packages.core.models import Chunk
from services.ingestion.graph_store import KnowledgeGraphStore
from services.ingestion.vector_store import VectorStoreManager
from services.rag_engine.agent.graph import build_rag_agent_graph
from services.rag_engine.retrieval.hybrid import HybridRetriever


class FailingClient:
    async def chat_completion(self, **kwargs):
        raise RuntimeError("repro provider failure")


async def main():
    os.environ.pop("APP_ENV", None)
    chunks = [Chunk(id="repro", document_id="repro", text="Qdrant stores vectors.")]
    vector_store = VectorStoreManager(in_memory=True)
    vector_store.index_chunks(chunks)
    retriever = HybridRetriever(vector_store=vector_store, chunks=chunks)
    graph = build_rag_agent_graph(retriever, KnowledgeGraphStore(in_memory=True), llm_client=FailingClient())
    state = await graph.ainvoke({
        "query": "What does Qdrant store?", "current_search_query": "What does Qdrant store?",
        "retrieved_chunks": [], "entities": [], "draft_answer": "", "critic_verdict": None,
        "cycle_count": 0, "max_cycles": 1, "is_grounded": False, "is_refusal": False,
        "tenant_id": "repro",
    })
    print(json.dumps({"is_refusal": state.get("is_refusal"), "generation_error": state.get("generation_error")}))


asyncio.run(main())
