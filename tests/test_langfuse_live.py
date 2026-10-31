"""Live observation-context integration for optional Langfuse export."""

import asyncio
import sys
import time
from contextlib import contextmanager
from types import ModuleType

import pytest

from packages.core.models import Chunk
from services.ingestion.graph_store import KnowledgeGraphStore
from services.rag_engine.agent.graph import build_rag_agent_graph
from services.rag_engine.observability.langfuse_client import LangfuseTracer
from services.rag_engine.retrieval.hybrid import RankedChunk, RetrievalResult


class _Observation:
    def __init__(self, record):
        self.record = record

    def update(self, **attributes):
        self.record["updates"].update(attributes)


class _FakeLangfuse:
    def __init__(self, **_kwargs):
        self.observations = []
        self.active = []

    @contextmanager
    def start_as_current_observation(self, **attributes):
        record = {
            "attributes": attributes,
            "parent": self.active[-1] if self.active else None,
            "updates": {},
        }
        observation = _Observation(record)
        record["observation"] = observation
        record["started"] = time.perf_counter()
        self.observations.append(record)
        self.active.append(record)
        try:
            yield observation
        finally:
            record["duration_ms"] = (time.perf_counter() - record["started"]) * 1000
            self.active.pop()


@pytest.mark.asyncio
async def test_langfuse_generation_context_wraps_provider_call_and_exports_usage(
    monkeypatch,
):
    sdk_clients = []

    def make_client(**kwargs):
        client = _FakeLangfuse(**kwargs)
        sdk_clients.append(client)
        return client

    fake_langfuse = ModuleType("langfuse")
    fake_langfuse.Langfuse = make_client
    monkeypatch.setitem(sys.modules, "langfuse", fake_langfuse)
    monkeypatch.setenv("LANGFUSE_ENABLED", "true")
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")
    tracer = LangfuseTracer()
    sdk = sdk_clients[0]

    class Retriever:
        def retrieve(self, query, top_k=5, tenant_id="default", debug=False):
            chunk = Chunk(
                id="chunk-1",
                document_id="doc-1",
                text="Meridian uses the Atlas gateway.",
                metadata={"tenant_id": tenant_id},
            )
            return RetrievalResult(
                query,
                top_k,
                [RankedChunk(chunk, 1, {"dense": 0.99, "bm25": 1.0, "final": 0.99})],
                timings_ms={"total": 1.0},
            )

    class Provider:
        observation_was_open = False

        async def chat_completion(self, **_kwargs):
            active = sdk.active[-1]
            self.observation_was_open = (
                active["attributes"].get("name") == "generate"
                and active["attributes"].get("as_type") == "generation"
            )
            await asyncio.sleep(0.005)
            return {
                "choices": [{"message": {"content": "Meridian uses Atlas. [1]"}}],
                "model": "gpt-4o-mini",
                "provider": "test-provider",
                "usage": {"prompt_tokens": 23, "completion_tokens": 6},
            }

    provider = Provider()
    graph = build_rag_agent_graph(
        retriever=Retriever(),
        graph_store=KnowledgeGraphStore(in_memory=True),
        llm_client=provider,
        llm_config_getter=lambda: {"model": "gpt-4o-mini", "provider": "test-provider"},
        verify_mode="off",
        tracer=tracer,
    )
    query = "private query that must not be exported"
    state = {
        "query": query,
        "current_search_query": query,
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": 1,
        "is_refusal": False,
        "tenant_id": "tenant-a",
    }

    with tracer.trace("rag-query-pipeline", tenant_id="tenant-a", query=query):
        result = await graph.ainvoke(state, config={"configurable": {"top_k": 1}})

    assert provider.observation_was_open is True
    generation = next(
        item for item in sdk.observations if item["attributes"].get("name") == "generate"
    )
    assert generation["parent"]["attributes"]["name"] == "rag-query-pipeline"
    assert generation["duration_ms"] > 0
    assert generation["updates"]["usage_details"] == {"input": 23, "output": 6}
    assert generation["updates"]["metadata"]["duration_ms"] > 0
    assert generation["updates"]["metadata"]["estimated"] is False
    assert generation["updates"]["metadata"]["cost_usd"] is not None
    assert generation["updates"]["model"] == "gpt-4o-mini"
    assert generation["updates"]["cost_details"]["total"] > 0
    assert not any(query in repr(item["attributes"]) for item in sdk.observations)
    assert result["usage"]["total_tokens"] == 29
