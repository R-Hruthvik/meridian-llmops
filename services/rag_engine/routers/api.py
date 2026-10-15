"""Unified Meridian RAG Engine & LLMOps FastAPI Application."""

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, cast

import httpx
from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    File,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from qdrant_client import QdrantClient
from sqlalchemy.ext.asyncio import AsyncSession

from packages.core.errors import IndexReadError, IndexWriteError, IngestionError, ProviderError
from packages.core.models import (
    DocumentFormat,
    GuardrailResult,
    IngestDocumentRequest,
    QueryRequest,
    QueryResponse,
    ReviewStatus,
    SearchResult,
    ServingProvenance,
    VerificationSummary,
)
from packages.core.settings import get_settings as _core_get_settings
from packages.core.settings import validate_production as _validate_production
from services.gateway.auth import validate_auth_configuration
from services.gateway.client import LiteLLMClient
from services.gateway.guardrails.input_rails import InputGuardrails
from services.gateway.guardrails.output_rails import OutputGuardrails
from services.ingestion.embedder import FastEmbedEmbedder
from services.ingestion.graph_store import KnowledgeGraphStore
from services.ingestion.manifest import ConsistencyReport, check_consistency
from services.ingestion.pipeline import IngestionPipeline
from services.ingestion.vector_store import QdrantChunkStore
from services.rag_engine.agent.graph import build_rag_agent_graph
from services.rag_engine.deps import get_db, get_services, require_admin, require_user
from services.rag_engine.observability.langfuse_client import LangfuseTracer
from services.rag_engine.retrieval.hybrid import HybridRetriever
from services.rag_engine.retrieval.reranker import CrossEncoderReranker, LexicalReranker
from services.rag_engine.routers._state import (  # noqa: F401 - shared state re-exported for import/monkeypatch compatibility
    SECRET_SUFFIX,
    SETTINGS_FILE,
    _active_services,
    _default_llm_settings,
    _default_services,
    _get_secrets_file,
    _get_settings_file,
    _index_gate,
    _is_masked,
    _load_persisted_settings,
    _merge_preserving_saved,
    _model_fetch_get,
    _resolve_active_llm_config_with_secrets,
    _runtime_llm_settings,
    _save_persisted_settings,
    _settings,
    _settings_lock,
    _tested_api_keys,
    _validate_model_fetch_url,
    agent_graph,
    get_active_llm_config,
    graph_store,
    ingestion_pipeline,
    init_db,
    input_guardrails,
    llm_client,
    logger,
    masked_llm_view,
    output_guardrails,
    retriever,
    tracer,
    vector_store,
)
from services.rag_engine.routers.ops import router as ops_router
from services.rag_engine.routers.review import review_flagged_chunk_ids
from services.rag_engine.routers.review import router as review_router
from services.rag_engine.routers.settings import (
    TestAndFetchModelsRequest,  # noqa: F401 - re-exported for test/import compatibility
    test_and_fetch_models,  # noqa: F401 - re-exported for test/import compatibility
)
from services.rag_engine.routers.settings import router as settings_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize the semantic model once before serving or loading persisted chunks."""
    settings = app.state.settings or _core_get_settings()
    app.state.settings = settings
    validate_auth_configuration()
    _validate_production(settings)
    if ingestion_pipeline.embedder is None:
        embedder = await asyncio.to_thread(
            FastEmbedEmbedder,
            settings.embedding_model,
            cache_path=settings.fastembed_cache_path,
            expected_dim=settings.qdrant_vector_dim,
        )
        ingestion_pipeline.embedder = embedder
    retriever.embedder = ingestion_pipeline.embedder
    retriever.reranker = None
    if settings.reranker == "lexical":
        retriever.reranker = LexicalReranker()
    elif settings.reranker == "cross_encoder":
        retriever.reranker = await asyncio.to_thread(
            CrossEncoderReranker, settings.reranker_model, settings.fastembed_cache_path
        )
    await asyncio.to_thread(vector_store.ensure_collection)
    docs_loaded = await asyncio.to_thread(ingestion_pipeline.load_persisted_knowledge_base)
    logger.info("Hydrated %d documents from dedicated storage.", docs_loaded)
    retriever.update_chunks(vector_store.get_all_chunks(None))
    global _index_consistency, _service_status
    disk_chunks = await asyncio.to_thread(lambda: len(ingestion_pipeline.storage.load_all_chunks()))
    qdrant_points = await asyncio.to_thread(vector_store.count)
    _index_consistency = await asyncio.to_thread(
        check_consistency, settings, qdrant_points, disk_chunks
    )
    app.state.index_consistency = _index_consistency
    app.state.service_status = _check_docker_services(settings)
    _service_status = app.state.service_status
    if _index_consistency.ok:
        logger.info("Index consistent: %d chunks across disk and Qdrant.", disk_chunks)
    else:
        logger.error("Index inconsistent; queries are refused until reindex: %s", _index_consistency.reasons)
    try:
        await init_db()
    except Exception as e:  # noqa: BLE001 - preserve existing database startup behavior
        logger.warning("Database initialization warning: %s", e)
    yield


router = APIRouter(dependencies=[Depends(get_services)])
router.include_router(review_router)
router.include_router(ops_router)
router.include_router(settings_router)


async def handle_index_error(request: Request, error: IndexWriteError | IndexReadError) -> JSONResponse:
    code = 'index_write_error' if isinstance(error, IndexWriteError) else 'index_read_error'
    return JSONResponse(status_code=503, content={'error': {'code': code, 'message': str(error)}})


async def handle_provider_error(request: Request, error: ProviderError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status,
        content={"error": {
            "code": "provider_error",
            "message": error.message,
            "provider_message": error.provider_message,
        }},
    )


async def limit_model_fetch_json_body(request: Request, call_next):
    if request.url.path == "/v1/settings/llm/test-and-fetch-models" and request.method == "POST":
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > 1024 * 1024:
                return JSONResponse(status_code=413, content={"detail": "Request body too large."})
            body.extend(chunk)

        payload = bytes(body)

        async def receive():
            return {"type": "http.request", "body": payload, "more_body": False}

        request = Request(request.scope, receive)
    return await call_next(request)




# Startup consistency verdict; None until the lifespan has run.
_index_consistency: ConsistencyReport | None = None

# Service readiness tracking
_service_status: dict[str, Any] = {
    "qdrant": {"status": "unknown", "endpoint": "", "reachable": False},
    "neo4j": {"status": "unknown", "endpoint": "", "reachable": False},
    "litellm": {"status": "unknown", "endpoint": "", "reachable": False},
}


def _probe_http(url: str, timeout: float = 2.0) -> bool:
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url)
            return resp.status_code < 500
    except Exception:  # noqa: BLE001 - any probe failure means unreachable
        return False


def _check_docker_services(settings=None) -> dict[str, Any]:
    if settings is None:
        settings = _core_get_settings()

    qdrant_url = f"http://{getattr(settings, 'qdrant_host', 'localhost')}:{getattr(settings, 'qdrant_port', 6333)}/collections" if settings else "http://localhost:6333/collections"
    neo4j_url = "http://localhost:7474"
    litellm_url = f"{getattr(settings, 'litellm_base_url', 'http://localhost:4000').rstrip('/')}/health" if settings else "http://localhost:4000/health"

    qdrant_ok = _probe_http(qdrant_url)
    neo4j_ok = _probe_http(neo4j_url)
    litellm_ok = _probe_http(litellm_url) or _probe_http(f"{litellm_url}/readiness")

    statuses: dict[str, Any] = {
        "qdrant": {"status": "reachable" if qdrant_ok else "degraded", "endpoint": qdrant_url, "reachable": qdrant_ok},
        "neo4j": {"status": "reachable" if neo4j_ok else "degraded", "endpoint": neo4j_url, "reachable": neo4j_ok},
        "litellm": {"status": "reachable" if litellm_ok else "degraded", "endpoint": litellm_url, "reachable": litellm_ok},
    }
    return statuses


def _log_service_banner(statuses: dict[str, Any]) -> None:
    lines = ["", "=" * 62, " Meridian Service Readiness Check", "=" * 62]
    for name, info in statuses.items():
        icon = "✓" if info["reachable"] else "✗"
        state = "REACHABLE" if info["reachable"] else "DEGRADED"
        lines.append(f"  {icon} {name:10s} [{state:30s}] {info['endpoint']}")
    if all(v["reachable"] for v in statuses.values()):
        lines.append("  All Docker services reachable - production mode")
    else:
        lines.append("  Some services degraded - in-memory fallback active (graceful)")
    lines.append("=" * 62)
    logger.info("\n".join(lines))


class GuardrailCheckRequest(BaseModel):
    text: str = Field(..., min_length=1)


@router.get("/v1/guardrails/check", response_model=GuardrailResult, deprecated=True)
async def check_guardrails_get(
    text: str,
    tenant_id: str = Depends(require_user),
):
    """Legacy query-string form; use POST to keep submitted text out of URLs.

    Served here too because the browser reaches the rag engine directly.
    """
    return input_guardrails.evaluate(text)


@router.post("/v1/guardrails/check", response_model=GuardrailResult)
async def check_guardrails_post(
    payload: GuardrailCheckRequest,
    tenant_id: str = Depends(require_user),
):
    """Evaluate text against the shared input guardrails."""
    return input_guardrails.evaluate(payload.text)


class RetrieveRequest(BaseModel):
    """Retrieval-only payload: no LLM call, just ranked chunks."""

    query: str = Field(..., min_length=1, description="Search query")
    top_k: int = Field(5, ge=1, le=20, description="Number of chunks to return")
    debug: bool = Field(False, description="Include per-stage score detail")


@router.post("/v1/retrieve")
async def retrieve_endpoint(
    payload: RetrieveRequest,
    request: Request,
    tenant_id: str = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Runs hybrid retrieval only (dense + BM25 + RRF) and returns ranked chunks.

    The primary debugging tool: inspect which chunks would reach the LLM,
    with per-stage scores and stage timings, before involving generation.
    """
    blocked = _index_gate(request)
    if blocked is not None:
        return blocked
    flagged_chunk_ids = await _review_flags(db)
    result = retriever.retrieve(
        payload.query,
        top_k=payload.top_k,
        tenant_id=tenant_id,
        debug=payload.debug,
        flagged_chunk_ids=flagged_chunk_ids,
    )
    return {
        "query": result.query,
        "top_k": result.top_k,
        "chunks": [ranked.to_dict() for ranked in result.chunks],
        "timings_ms": result.timings_ms,
    }


@router.post("/v1/documents")
async def upload_documents_endpoint(
    files: Annotated[list[UploadFile], File()],
    tenant_id: str = Depends(require_user),
):
    """Multipart upload (field ``files``, repeatable); one result row per file.

    Rejected files (bad type, oversized, unparseable) do not fail the whole
    request: their row carries ``status: rejected`` with the reason.
    """
    results: list[dict[str, Any]] = []
    for upload in files:
        filename = upload.filename or "upload"
        try:
            data = bytearray()
            limit = ingestion_pipeline.max_upload_bytes
            while block := await upload.read(min(64 * 1024, limit + 1 - len(data))):
                data.extend(block)
                if len(data) > limit:
                    raise IngestionError(f"{filename} exceeds the {limit / (1024 * 1024):g} MB upload limit")
            result = ingestion_pipeline.ingest_file(filename, bytes(data), tenant_id=tenant_id)
            results.append(result.to_dict())
        except IngestionError as error:
            results.append(
                {
                    "filename": filename,
                    "status": "rejected",
                    "document_id": None,
                    "format": None,
                    "pages": 0,
                    "chunks": 0,
                    "warnings": [],
                    "duplicate_of": None,
                    "error": str(error),
                }
            )
    retriever.update_chunks(vector_store.get_all_chunks(None))
    return {"results": results}


@router.post("/v1/ingest")
async def ingest_document_endpoint(
    payload: IngestDocumentRequest,
    tenant_id: str = Depends(require_user),
):
    """Ingests text into dedicated disk storage, the Qdrant vector store, and the graph."""
    try:
        result = ingestion_pipeline.ingest_text(
            text=payload.text,
            title=payload.title or "Uploaded Document",
            source=payload.source or "manual",
            doc_format=DocumentFormat(payload.format) if payload.format else DocumentFormat.MARKDOWN,
            tenant_id=tenant_id,
        )
    except IngestionError as error:
        cause = error.__cause__
        if isinstance(cause, (IndexWriteError, IndexReadError)):
            # A typed index failure must reach the caller with its own code.
            raise cause from None
        raise HTTPException(status_code=400, detail=str(error)) from error
    retriever.update_chunks(vector_store.get_all_chunks(None))
    return {
        **result.to_dict(),
        "title": payload.title or "Uploaded Document",
        "chunks_indexed": result.chunks,
    }


def _sse_event(event: str, data: dict[str, Any]) -> str:
    """Encode one Server-Sent Events frame with a named event and JSON payload."""
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


async def _review_flags(db: AsyncSession) -> set[str]:
    """Best-effort review-flag lookup; a review store that is not ready must not break retrieval."""
    try:
        return await review_flagged_chunk_ids(db)
    except Exception as error:  # noqa: BLE001 - retrieval proceeds unpenalized when the review store is down
        logger.warning("Review-flag lookup failed; retrieving without penalties (%s)", type(error).__name__)
        return set()


@router.post("/v1/query", response_model=QueryResponse)
async def query_endpoint(
    req: QueryRequest,
    request: Request,
    tenant_id: str = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Executes the self-healing Agentic RAG pipeline with guardrails and tracing."""
    blocked = _index_gate(request)
    if blocked is not None:
        return blocked
    start_time = time.perf_counter()
    request_id = str(uuid.uuid4())
    trace_ctx = tracer.trace(name="rag-query-pipeline", tenant_id=tenant_id, query=req.query)
    client_guardrails_enabled = not (
        req.enforce_guardrails is False and _settings.allow_client_disable_guardrails
    )
    input_guardrails_enabled = _settings.enable_input_guardrails and client_guardrails_enabled
    output_guardrails_enabled = _settings.enable_output_guardrails and client_guardrails_enabled

    with trace_ctx as trace:
        # 1. Input Guardrails
        if input_guardrails_enabled:
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
                "cycle_count": 0,
                "max_cycles": req.max_cycles,
                "is_refusal": False,
                "tenant_id": tenant_id,
                "answer_status": "answered",
                "verification_result": None,
                "timings_ms": {},
                "request_id": request_id,
                "serving_provider": None,
                "serving_model": None,
                "usage": None,
                "debug": {},
            }
            final_state = await agent_graph.ainvoke(
                initial_state,
                config={"configurable": {"top_k": req.top_k}},
            )
            span.set_attribute("cycle_count", final_state["cycle_count"])
            verification_result = final_state.get("verification_result")
            span.set_attribute(
                "verification_status",
                verification_result.status if verification_result else "unchecked",
            )

        # 3. Output Guardrails
        raw_answer = final_state.get("draft_answer", "")
        if output_guardrails_enabled and not final_state.get("is_refusal", False):
            with trace.span("output-guardrails") as span:
                out_result = output_guardrails.evaluate(raw_answer)
                span.set_attribute("allowed", out_result.allowed)
                final_answer = out_result.sanitized_text
                if not out_result.allowed:
                    final_state["answer_status"] = "refused"
                    final_state["is_refusal"] = True
                    final_state["verification_result"] = VerificationSummary(status="unchecked", scope="unchecked")
        else:
            final_answer = raw_answer

    elapsed_ms = (time.perf_counter() - start_time) * 1000
    timings_ms = dict(final_state.get("timings_ms") or {})
    timings_ms["total"] = elapsed_ms
    provider_value = final_state.get("serving_provider")
    model_value = final_state.get("serving_model")
    if final_state.get("is_refusal", False):
        provider_value, model_value = None, None
    llm_served = bool(provider_value and model_value)

    chunks_data = [
        SearchResult.model_validate(chunk)
        for chunk in final_state.get("retrieved_chunks", [])
    ]
    verification_result = final_state.get("verification_result")
    verification = VerificationSummary.model_validate(
        verification_result.model_dump() if verification_result is not None else {}
    )

    degraded_reason: str | None = final_state.get("generation_error")
    flagged_chunk_ids = await _review_flags(db) & {chunk.chunk_id for chunk in chunks_data}
    return QueryResponse(
        query=req.query,
        answer=final_answer,
        source_chunks=chunks_data,
        entities=final_state.get("entities", []),
        cycle_count=final_state.get("cycle_count", 1),
        verified=verification.status == "supported",
        refusal=final_state.get("is_refusal", False),
        execution_time_ms=elapsed_ms,
        serving_provider=provider_value,
        serving_model=model_value,
        serving=ServingProvenance(
            provider=provider_value,
            model=model_value,
            fresh=llm_served,
        ),
        degraded_reason=degraded_reason,
        answer_status=final_state.get("answer_status", "answered"),
        verification=verification,
        debug=final_state.get("debug", {}),
        sources=chunks_data,
        request_id=request_id,
        trace_id=trace.id,
        review_status=ReviewStatus(flagged_chunk_ids=sorted(flagged_chunk_ids)),
        provider=provider_value,
        model=model_value,
        timings_ms=timings_ms,
        usage=final_state.get("usage"),
    )


async def _stream_query_response(
    req: QueryRequest,
    tenant_id: str,
    sanitized_query: str,
    request_id: str,
    output_guardrails_enabled: bool,
) -> AsyncIterator[str]:
    """Yield SSE frames for one agentic RAG pipeline run.

    The graph runs concurrently with a pump that forwards generation deltas, so
    ``token`` frames are emitted as the provider produces them: the first token
    no longer waits for generation or verification to finish. ``retrieval_complete``
    is gated ahead of the first token frame. If the graph raises, an ``error``
    frame precedes ``done`` so the stream always terminates cleanly.
    """
    initial_state: dict[str, Any] = {
        "query": sanitized_query,
        "current_search_query": sanitized_query,
        "retrieved_chunks": [],
        "entities": [],
        "draft_answer": "",
        "cycle_count": 0,
        "max_cycles": req.max_cycles,
        "is_refusal": False,
        "tenant_id": tenant_id,
        "answer_status": "answered",
        "verification_result": None,
        "timings_ms": {},
        "request_id": request_id,
        "serving_provider": None,
        "serving_model": None,
        "usage": None,
        "debug": {},
    }

    events: asyncio.Queue[Any] = asyncio.Queue()
    token_sink: asyncio.Queue[Any] = asyncio.Queue()
    retrieval_ready = asyncio.Event()
    outcome: dict[str, Any] = {"final_state": {}, "error": None}

    async def pump_tokens() -> None:
        await retrieval_ready.wait()
        while True:
            delta = await token_sink.get()
            if delta is None:
                return
            await events.put(_sse_event("token", {"delta": delta}))

    async def run_graph() -> None:
        final_state: dict[str, Any] = {}
        try:
            async for update in agent_graph.astream(
                initial_state,
                config={"configurable": {"top_k": req.top_k, "token_sink": token_sink}},
                stream_mode="updates",
            ):
                for node_name, node_update in update.items():
                    if node_update:
                        final_state.update(node_update)
                    if node_name == "retrieve":
                        chunks = (node_update or {}).get("retrieved_chunks", [])
                        await events.put(
                            _sse_event(
                                "retrieval_complete",
                                {
                                    "chunk_ids": [chunk.chunk_id for chunk in chunks],
                                    "timings_ms": (node_update or {}).get("timings_ms", {}),
                                },
                            )
                        )
                        retrieval_ready.set()
        except Exception as exc:  # noqa: BLE001 - surfaced to the client as an error frame
            outcome["error"] = exc
        finally:
            # Always unblock the pump and flush its remaining frames, even on failure.
            retrieval_ready.set()
            token_sink.put_nowait(None)
        outcome["final_state"] = final_state
        await pump_task
        await events.put(None)

    pump_task = asyncio.create_task(pump_tokens())
    graph_task = asyncio.create_task(run_graph())
    try:
        while True:
            item = await events.get()
            if item is None:
                break
            yield item
    finally:
        for task in (graph_task, pump_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(graph_task, pump_task, return_exceptions=True)

    final_state = outcome["final_state"]
    error = outcome["error"]
    if error is not None:
        yield _sse_event("error", {"message": str(error)})

    raw_answer = final_state.get("draft_answer", "")
    if output_guardrails_enabled and not final_state.get("is_refusal", False):
        out_result = output_guardrails.evaluate(raw_answer)
        final_answer = out_result.sanitized_text
        if not out_result.allowed:
            final_state["answer_status"] = "refused"
            final_state["is_refusal"] = True
            final_state["verification_result"] = VerificationSummary(status="unchecked", scope="unchecked")
    else:
        final_answer = raw_answer

    verification_result = final_state.get("verification_result")
    verification = VerificationSummary.model_validate(
        verification_result.model_dump() if verification_result is not None else {}
    )
    yield _sse_event(
        "verification_complete",
        {
            "status": verification.status,
            "citations": [chunk.chunk_id for chunk in final_state.get("retrieved_chunks", [])],
        },
    )
    yield _sse_event(
        "done",
        {
            "request_id": request_id,
            "answer": final_answer,
            "answer_status": final_state.get("answer_status", "answered"),
        },
    )


@router.post("/v1/query/stream")
async def query_stream_endpoint(
    req: QueryRequest,
    request: Request,
    tenant_id: str = Depends(require_user),
):
    """Streams the agentic RAG pipeline as Server-Sent Events.

    Emits ``retrieval_complete``, ``token``, ``verification_complete``, and
    ``done`` frames. See :func:`_stream_query_response` for what is streamed
    live versus delivered once generation completes.
    """
    blocked = _index_gate(request)
    if blocked is not None:
        return blocked
    client_guardrails_enabled = not (
        req.enforce_guardrails is False and _settings.allow_client_disable_guardrails
    )
    input_guardrails_enabled = _settings.enable_input_guardrails and client_guardrails_enabled
    output_guardrails_enabled = _settings.enable_output_guardrails and client_guardrails_enabled

    sanitized_query = req.query
    if input_guardrails_enabled:
        guard_result = input_guardrails.evaluate(req.query)
        if not guard_result.allowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Prompt injection detected: {', '.join(guard_result.policy_violations)}",
            )
        sanitized_query = guard_result.sanitized_text

    request_id = str(uuid.uuid4())
    return StreamingResponse(
        _stream_query_response(
            req=req,
            tenant_id=tenant_id,
            sanitized_query=sanitized_query,
            request_id=request_id,
            output_guardrails_enabled=output_guardrails_enabled,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/v1/documents")
async def clear_all_documents_endpoint(tenant_id: str = Depends(require_admin)):
    """Clears all documents and chunks from dedicated storage and active memory."""
    count = ingestion_pipeline.clear_all()
    retriever.update_chunks(vector_store.get_all_chunks(None))
    return {"status": "cleared", "deleted_count": count, "message": f"All {count} documents removed from storage"}


@router.post("/v1/documents/seed-samples")
async def seed_sample_documents_endpoint(tenant_id: str = Depends(require_admin)):
    """Seeds or resets the default sample documentation into the knowledge base."""
    sample_docs_dir = Path(__file__).parents[2] / "sample_docs"
    count = 0
    if sample_docs_dir.exists():
        for doc_file in sample_docs_dir.glob("*.md"):
            title = doc_file.stem.replace("_", " ").title()
            ingestion_pipeline.ingest_text(
                text=doc_file.read_text(encoding="utf-8", errors="ignore"),
                title=title,
                doc_format=DocumentFormat.MARKDOWN,
                source=str(doc_file.name),
                tenant_id=tenant_id,
            )
            count += 1
    retriever.update_chunks(vector_store.get_all_chunks(None))
    return {"status": "seeded", "documents_seeded": count}


def _get_document_list_response(tenant_id: str) -> dict[str, Any]:
    """Builds the shared document catalog response dict."""
    docs = ingestion_pipeline.get_documents(tenant_id=tenant_id)
    total_chunks = sum(d.get("chunk_count", 0) for d in docs)
    total_entities = sum(d.get("entities_count", 0) for d in docs)
    return {
        "total_documents": len(docs),
        "total_chunks": total_chunks,
        "total_entities": total_entities,
        "documents": docs,
    }


@router.get("/v1/documents")
async def list_documents_endpoint(tenant_id: str = Depends(require_user)):
    """Lists all stored documents in the permanent knowledge base catalog."""
    return _get_document_list_response(tenant_id)


@router.get("/v1/documents/catalog")
async def catalog_alias_endpoint(tenant_id: str = Depends(require_user)):
    """Alias for document catalog - returns same as /v1/documents for UI compatibility.

    .. deprecated::
        Use :get:`/v1/documents` instead.
    """
    response = _get_document_list_response(tenant_id)
    response["Deprecation"] = "true"
    response["Sunset"] = "2027-01-01"
    return response


@router.get("/v1/documents/{doc_id}/chunks")
async def get_document_chunks_endpoint(
    doc_id: str,
    limit: int = 100,
    offset: int = 0,
    tenant_id: str = Depends(require_user),
):
    """Returns a page of structural chunks for a document with headings and pages."""
    doc = ingestion_pipeline.get_document(doc_id, tenant_id=tenant_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found in knowledge base.")
    chunks = doc.get("chunks", [])
    return {
        "document_id": doc_id,
        "title": doc.get("title", ""),
        "total_chunks": len(chunks),
        "limit": limit,
        "offset": offset,
        "chunks": chunks[offset : offset + limit],
    }


@router.get("/v1/documents/{doc_id}")
async def get_document_details_endpoint(doc_id: str, tenant_id: str = Depends(require_user)):
    """Retrieves full document metadata and its constituent chunks."""
    doc = ingestion_pipeline.get_document(doc_id, tenant_id=tenant_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found in knowledge base.")
    return doc


@router.delete("/v1/documents/{doc_id}")
async def delete_document_endpoint(doc_id: str, tenant_id: str = Depends(require_user)):
    """Deletes a document and evicts its chunks from vector, lexical, and graph stores."""
    doc = ingestion_pipeline.get_document(doc_id, tenant_id=tenant_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found in knowledge base.")
    chunk_ids = [chunk["id"] for chunk in doc.get("chunks", [])]
    deleted = ingestion_pipeline.delete_document(doc_id, tenant_id=tenant_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found in knowledge base.")
    retriever.remove_chunks(chunk_ids)
    return {"status": "deleted", "document_id": doc_id, "message": "Document successfully deleted"}


def create_app(settings=None, overrides=None) -> FastAPI:
    """Create a FastAPI app with per-instance services initialized at startup."""
    service_overrides = dict(overrides or {})

    @asynccontextmanager
    async def app_lifespan(application: FastAPI):
        runtime_settings = application.state.settings or _core_get_settings()
        application.state.settings = runtime_settings
        if getattr(application.state, "use_legacy_services", False):
            runtime_settings = _settings._target()
            application.state.settings = runtime_settings
            services = _default_services()
            services["runtime_llm_settings"] = _runtime_llm_settings._target()
        else:
            required_services = {
            "vector_store", "graph_store", "ingestion_pipeline", "tracer", "retriever",
            "llm_client", "input_guardrails", "output_guardrails", "agent_graph",
        }
            if required_services.issubset(service_overrides):
                services = dict(service_overrides)
            else:
                services = _build_services(runtime_settings)
                services.update(service_overrides)
            services["runtime_llm_settings"] = service_overrides.get(
                "runtime_llm_settings", _load_persisted_settings()
            )
        for name, service in services.items():
            setattr(application.state, name, service)
        token = _active_services.set({**services, "settings": runtime_settings})
        try:
            await _startup(application, runtime_settings)
            yield
        finally:
            _active_services.reset(token)

    application = FastAPI(
        title="Meridian LLMOps RAG Engine",
        version="0.1.0",
        description="Production-grade Self-Healing Agentic RAG Platform with Guardrails and Tracing",
        lifespan=app_lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    application.include_router(router)
    application.add_exception_handler(IndexWriteError, cast(Any, handle_index_error))
    application.add_exception_handler(IndexReadError, cast(Any, handle_index_error))
    application.add_exception_handler(ProviderError, cast(Any, handle_provider_error))
    application.middleware("http")(bind_app_services)
    application.middleware("http")(limit_model_fetch_json_body)
    application.state.settings = settings
    application.state.service_overrides = service_overrides
    application.state.service_status = {
        name: dict(status) for name, status in _service_status.items()
    }
    return application


async def bind_app_services(request: Request, call_next):
    services = getattr(request.app.state, "service_overrides", {})
    if getattr(request.app.state, "vector_store", None) is not None:
        services = {name: getattr(request.app.state, name) for name in (
            "vector_store", "graph_store", "ingestion_pipeline", "tracer", "retriever",
            "llm_client", "input_guardrails", "output_guardrails", "agent_graph",
        )}
        services["settings"] = (
            _core_get_settings()
            if getattr(request.app.state, "use_legacy_services", False)
            else request.app.state.settings
        )
        services["runtime_llm_settings"] = request.app.state.runtime_llm_settings
    token = _active_services.set(services or None)
    try:
        return await call_next(request)
    finally:
        _active_services.reset(token)


def _build_services(settings) -> dict[str, Any]:
    client = (QdrantClient(':memory:') if settings.qdrant_local_path == ':memory:' else QdrantClient(path=settings.qdrant_local_path)) if settings.vector_backend == 'qdrant_local' else QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port, timeout=5)
    vector = QdrantChunkStore(client, settings.qdrant_collection, settings.qdrant_vector_dim)
    graph = KnowledgeGraphStore(in_memory=not settings.graph_enabled)
    pipeline = IngestionPipeline(vector_store=vector, graph_store=graph, max_upload_bytes=settings.max_upload_mb * 1024 * 1024)
    trace = LangfuseTracer()
    retrieval = HybridRetriever(embedder=None, vector_store=vector, tracer=trace)
    llm = LiteLLMClient(allow_private_provider_urls=settings.allow_private_provider_urls)
    return {
        "vector_store": vector,
        "graph_store": graph,
        "ingestion_pipeline": pipeline,
        "tracer": trace,
        "retriever": retrieval,
        "llm_client": llm,
        "input_guardrails": InputGuardrails(),
        "output_guardrails": OutputGuardrails(),
        "agent_graph": build_rag_agent_graph(
            retriever=retrieval,
            graph_store=graph,
            llm_client=llm,
            llm_config_getter=_resolve_active_llm_config_with_secrets,
            min_dense_score=settings.min_dense_score,
            graph_enabled=settings.graph_enabled,
            graph_context_enabled=settings.graph_context_enabled,
            debug_log_prompts=settings.debug_log_prompts,
            verify_mode=settings.verify_mode,
            tracer=trace,
        ),
    }


async def _startup(application: FastAPI, settings) -> None:
    """Initialize runtime resources for the app instance."""
    validate_auth_configuration()
    _validate_production(settings)
    embedder = application.state.ingestion_pipeline.embedder
    if embedder is None:
        embedder = await asyncio.to_thread(
            FastEmbedEmbedder,
            settings.embedding_model,
            cache_path=settings.fastembed_cache_path,
            expected_dim=settings.qdrant_vector_dim,
        )
        application.state.ingestion_pipeline.embedder = embedder
    application.state.retriever.embedder = embedder
    if settings.reranker == "lexical":
        application.state.retriever.reranker = LexicalReranker()
    elif settings.reranker == "cross_encoder":
        application.state.retriever.reranker = await asyncio.to_thread(
            CrossEncoderReranker, settings.reranker_model, settings.fastembed_cache_path
        )
    await asyncio.to_thread(application.state.vector_store.ensure_collection)
    await asyncio.to_thread(application.state.ingestion_pipeline.load_persisted_knowledge_base)
    application.state.retriever.update_chunks(application.state.vector_store.get_all_chunks(None))
    disk_chunks = await asyncio.to_thread(lambda: len(application.state.ingestion_pipeline.storage.load_all_chunks()))
    qdrant_points = await asyncio.to_thread(application.state.vector_store.count)
    service_overrides = application.state.service_overrides
    if "index_consistency" not in service_overrides:
        application.state.index_consistency = await asyncio.to_thread(
            check_consistency, settings, qdrant_points, disk_chunks
        )
    if "service_status" not in service_overrides:
        application.state.service_status = _check_docker_services(settings)
    if getattr(application.state, "use_legacy_services", False):
        global _index_consistency, _service_status
        _index_consistency = application.state.index_consistency
        _service_status = application.state.service_status
    _log_service_banner(application.state.service_status)
    try:
        await init_db()
    except Exception as error:  # noqa: BLE001 - keep the existing degraded DB startup behavior
        logger.warning("Database initialization warning: %s", error)
    mount_web(application)


# Mount Web UI frontend if built
web_dist = Path(__file__).parents[2] / "web" / "dist"
def mount_web(app: FastAPI) -> None:
    if web_dist.exists():
        app.mount("/", StaticFiles(directory=str(web_dist), html=True), name="web")


app = create_app()
app.state.use_legacy_services = True
