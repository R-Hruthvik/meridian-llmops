"""Unified Meridian RAG Engine & LLMOps FastAPI Application."""

import time
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, status

from packages.core.models import (
    DocumentFormat,
    QueryRequest,
    QueryResponse,
    SearchResult,
)
from services.gateway.auth import verify_api_key
from services.gateway.guardrails.input_rails import InputGuardrails
from services.gateway.guardrails.output_rails import OutputGuardrails
from services.ingestion.graph_store import KnowledgeGraphStore
from services.ingestion.pipeline import IngestionPipeline
from services.ingestion.vector_store import VectorStoreManager
from services.rag_engine.agent.graph import build_rag_agent_graph
from services.rag_engine.observability.langfuse_client import MeridianTracer
from services.rag_engine.retrieval.hybrid import HybridRetriever

app = FastAPI(
    title="Meridian LLMOps RAG Engine",
    version="0.1.0",
    description="Production-grade Self-Healing Agentic RAG Platform with Guardrails and Tracing",
)

# Core singletons
vector_store = VectorStoreManager(in_memory=True)
graph_store = KnowledgeGraphStore(in_memory=True)
ingestion_pipeline = IngestionPipeline(vector_store=vector_store, graph_store=graph_store)
retriever = HybridRetriever(vector_store=vector_store)
input_guardrails = InputGuardrails()
output_guardrails = OutputGuardrails()
tracer = MeridianTracer()

# Pre-seed documentation knowledge base for immediate querying
ingestion_pipeline.ingest_text(
    text="""# Meridian Platform Architecture
Meridian is an enterprise LLMOps platform combining self-healing Agentic RAG with LiteLLM gateway governance.
The system features dual-memory storage: Qdrant for dense vector similarity and Neo4j for Knowledge Graph entity relationships.
Input Guardrails prevent prompt injections and mask PII, while Critic Agent evaluates grounding in LangGraph.
DeepEval enforces automated quality assertions (Faithfulness >= 0.90, Answer Relevancy >= 0.80) in GitHub Actions CI/CD.
""",
    title="Meridian System Architecture",
    doc_format=DocumentFormat.MARKDOWN,
    source="architecture_overview.md",
)
retriever.update_chunks(vector_store.get_all_chunks())
agent_graph = build_rag_agent_graph(retriever=retriever, graph_store=graph_store)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "meridian-rag-engine"}


@app.post("/v1/ingest")
async def ingest_document_endpoint(
    payload: dict[str, Any],
    tenant_id: str = Depends(verify_api_key),
):
    """Ingests text or documents into Qdrant vector store and Neo4j knowledge graph."""
    text = payload.get("text", "")
    title = payload.get("title", "Uploaded Document")
    if not text.strip():
        raise HTTPException(status_code=400, detail="Document text cannot be empty.")

    result = ingestion_pipeline.ingest_text(text=text, title=title)
    retriever.update_chunks(vector_store.get_all_chunks())
    return result


@app.post("/v1/query", response_model=QueryResponse)
async def query_endpoint(
    req: QueryRequest,
    tenant_id: str = Depends(verify_api_key),
):
    """Executes the self-healing Agentic RAG pipeline with guardrails and tracing."""
    start_time = time.time()
    trace_ctx = tracer.trace(name="rag-query-pipeline", tenant_id=tenant_id)

    with trace_ctx as trace:
        # 1. Input Guardrails
        if req.enforce_guardrails:
            with trace.span("input-guardrails") as span:
                guard_result = input_guardrails.evaluate(req.query)
                span.set_attribute("allowed", guard_result.allowed)
                if not guard_result.allowed:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Prompt injection detected: {', '.join(guard_result.policy_violations)}",
                    )
                sanitized_query = guard_result.sanitized_text
        else:
            sanitized_query = req.query

        # 2. LangGraph Agent Execution
        with trace.span("langgraph-cyclic-agent") as span:
            initial_state: dict[str, Any] = {
                "query": sanitized_query,
                "current_search_query": sanitized_query,
                "retrieved_chunks": [],
                "entities": [],
                "draft_answer": "",
                "critic_verdict": None,
                "cycle_count": 0,
                "max_cycles": req.max_cycles,
                "is_grounded": False,
                "is_refusal": False,
                "tenant_id": tenant_id,
            }
            final_state = await agent_graph.ainvoke(initial_state)
            span.set_attribute("cycle_count", final_state["cycle_count"])
            span.set_attribute("is_grounded", final_state["is_grounded"])

        # 3. Output Guardrails
        raw_answer = final_state.get("draft_answer", "")
        if req.enforce_guardrails and not final_state.get("is_refusal", False):
            with trace.span("output-guardrails") as span:
                out_result = output_guardrails.evaluate(raw_answer)
                span.set_attribute("allowed", out_result.allowed)
                final_answer = out_result.sanitized_text
        else:
            final_answer = raw_answer

        # 4. Record LLM generation span
        with trace.generation(name="critic-agent-llm") as gen:
            gen.set_tokens(
                prompt_tokens=len(req.query.split()) + 50,
                completion_tokens=len(final_answer.split()),
            )

    elapsed_ms = (time.time() - start_time) * 1000

    chunks_data = [
        SearchResult(
            chunk_id=c.get("chunk_id", "c"),
            document_id=c.get("document_id", "d"),
            text=c.get("text", ""),
            score=c.get("score", 1.0),
            retrieval_method="hybrid_rrf",
        )
        for c in final_state.get("retrieved_chunks", [])
    ]

    return QueryResponse(
        query=req.query,
        answer=final_answer,
        source_chunks=chunks_data,
        cycle_count=final_state.get("cycle_count", 1),
        verified=final_state.get("is_grounded", False),
        refusal=final_state.get("is_refusal", False),
        execution_time_ms=elapsed_ms,
    )


@app.get("/v1/metrics")
async def get_metrics(tenant_id: str = Depends(verify_api_key)):
    """Returns aggregated token usage and cost metrics."""
    return tracer.get_tenant_metrics(tenant_id)
