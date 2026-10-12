"""Show the graph behavior when the provider fails."""

import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from qdrant_client import QdrantClient

from packages.core.config import get_settings
from packages.core.errors import ProviderError
from packages.core.models import Chunk
from services.ingestion.embedder import FastEmbedEmbedder
from services.ingestion.graph_store import KnowledgeGraphStore
from services.ingestion.vector_store import QdrantChunkStore
from services.rag_engine.agent.graph import build_rag_agent_graph
from services.rag_engine.retrieval.hybrid import HybridRetriever


class FailingClient:
    async def chat_completion(self, **kwargs):
        raise RuntimeError("repro provider failure")


async def main():
    os.environ.pop("APP_ENV", None)
    chunks = [Chunk(id="repro", document_id="repro", text="Qdrant stores vectors.")]
    settings = get_settings()
    embedder = FastEmbedEmbedder(
        settings.embedding_model,
        cache_path=settings.fastembed_cache_path,
        expected_dim=settings.qdrant_vector_dim,
    )
    vector_store = QdrantChunkStore(QdrantClient(':memory:'), 'repro', embedder.dim)
    vector_store.ensure_collection()
    vector_store.upsert_chunks(chunks, embedder.embed_passages([chunk.text for chunk in chunks]))
    from services.rag_engine.retrieval.bm25 import BM25Index

    retriever = HybridRetriever(embedder=embedder, vector_store=vector_store, bm25_index=BM25Index(chunks))
    graph = build_rag_agent_graph(retriever, KnowledgeGraphStore(in_memory=True), llm_client=FailingClient())
    try:
        state = await graph.ainvoke({
            "query": "What does Qdrant store?", "current_search_query": "What does Qdrant store?",
            "retrieved_chunks": [], "entities": [], "draft_answer": "",
            "cycle_count": 0, "max_cycles": 1, "is_refusal": False,
            "tenant_id": "repro",
        })
    except ProviderError as error:
        print(json.dumps({"provider_error": error.status, "returned_as_refusal": False}))
        return
    print(json.dumps({"answer_status": state.get("answer_status"), "is_refusal": state.get("is_refusal", False)}))


asyncio.run(main())
