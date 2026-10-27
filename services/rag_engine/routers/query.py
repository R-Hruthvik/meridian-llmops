"""Query router: guardrails, retrieval, the agentic query, and SSE streaming.

Split out of :mod:`services.rag_engine.routers.api`. Shared service singletons
and helpers are resolved through the aggregation module at call time via
:class:`LiveRef`, so the test suite's monkeypatches on ``routers.api`` keep
taking effect.
"""

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from packages.core.models import (
    GuardrailResult,
    QueryRequest,
    QueryResponse,
    ReviewStatus,
    SearchResult,
    ServingProvenance,
    VerificationSummary,
)
from services.rag_engine.deps import get_db, require_user
from services.rag_engine.routers._state import (
    _settings,
    agent_graph_ref,
    index_gate_ref,
    input_guardrails,
    logger,
    output_guardrails,
    retriever_ref,
    tracer_ref,
)
from services.rag_engine.routers.review import review_flagged_chunk_ids

router = APIRouter()

# Resolve shared services/helpers through the aggregation module at call time so
# tests that rebind ``routers.api.<name>`` are honoured.
_index_gate = index_gate_ref
retriever = retriever_ref
tracer = tracer_ref
agent_graph = agent_graph_ref


class GuardrailCheckRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=100000)


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
    flagged_chunk_ids = await _review_flags(db, tenant_id)
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


def _sse_event(event: str, data: dict[str, Any]) -> str:
    """Encode one Server-Sent Events frame with a named event and JSON payload."""
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


async def _review_flags(db: AsyncSession, tenant_id: str) -> set[str]:
    """Best-effort review-flag lookup; a review store that is not ready must not break retrieval."""
    try:
        return await review_flagged_chunk_ids(db, tenant_id)
    except Exception as error:  # noqa: BLE001 - retrieval proceeds unpenalized when the review store is down
        logger.warning("Review-flag lookup failed; retrieving without penalties (%s)", type(error).__name__)
        return set()


class _FinalizedQueryResult(tuple):
    """Carrier for :func:`_finalize_query_result` output."""

    def __new__(cls, final_answer: Any, verification: Any, final_state: dict[str, Any] | None = None):
        obj = super().__new__(cls, (final_answer, verification))
        obj.final_answer = final_answer
        obj.answer = final_answer
        obj.verification = verification
        obj.final_state = final_state if final_state is not None else {}
        return obj

    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, str):
            if key in ("final_answer", "answer"):
                return self[0]
            if key == "verification":
                return self[1]
            if key == "final_state":
                return self.final_state
            if isinstance(self.final_state, dict) and key in self.final_state:
                return self.final_state[key]
            raise KeyError(key)
        return super().__getitem__(key)


def _resolve_output_guardrails(candidate: Any) -> Any:
    guardrails = candidate
    if guardrails is not None and not hasattr(guardrails, "evaluate"):
        guardrails = None
    if guardrails is None:
        guardrails = globals().get("output_guardrails")
    if guardrails is None or not hasattr(guardrails, "evaluate"):
        try:
            from services.rag_engine.routers import _state as _state_mod

            guardrails = getattr(_state_mod, "output_guardrails", None)
        except Exception:  # noqa: BLE001
            guardrails = None
    if guardrails is None or not hasattr(guardrails, "evaluate"):
        try:
            import sys

            api_mod = sys.modules.get("services.rag_engine.routers.api")
            if api_mod is not None:
                guardrails = getattr(api_mod, "output_guardrails", None)
        except Exception:  # noqa: BLE001
            guardrails = None
    return guardrails


def _finalize_query_result(
    final_state: dict[str, Any],
    output_guardrails_enabled: bool = True,
    output_guardrails: Any = None,
    raw_answer_override: Any = None,
) -> _FinalizedQueryResult:
    """Apply output guardrails and compute the verification summary."""
    if not isinstance(final_state, dict):
        final_state = {}
    guardrails = _resolve_output_guardrails(output_guardrails)
    raw_answer = (
        raw_answer_override
        if isinstance(raw_answer_override, str)
        else final_state.get("draft_answer", "")
    )
    if output_guardrails_enabled and not final_state.get("is_refusal", False):
        out_result = guardrails.evaluate(raw_answer)
        final_answer = out_result.sanitized_text
        if not out_result.allowed:
            final_state["answer_status"] = "refused"
            final_state["is_refusal"] = True
            final_state["verification_result"] = VerificationSummary(
                status="unchecked", scope="unchecked"
            )
    else:
        final_answer = raw_answer

    verification_result = final_state.get("verification_result")
    verification = VerificationSummary.model_validate(
        verification_result.model_dump() if verification_result is not None else {}
    )
    return _FinalizedQueryResult(final_answer, verification, final_state)


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
                "flagged_chunk_ids": sorted(await _review_flags(db, tenant_id)),
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
                config={"configurable": {"top_k": req.top_k, "token_sink": None}},
            )
            span.set_attribute("cycle_count", final_state["cycle_count"])
            verification_result = final_state.get("verification_result")
            span.set_attribute(
                "verification_status",
                verification_result.status if verification_result else "unchecked",
            )

        # 3. Output Guardrails
        with trace.span("output-guardrails") as span:
            finalized = _finalize_query_result(final_state, output_guardrails_enabled)
            final_answer = finalized.final_answer
            verification = finalized.verification
            span.set_attribute("allowed", not final_state.get("is_refusal", False))

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

    degraded_reason: str | None = final_state.get("generation_error")
    flagged_chunk_ids = await _review_flags(db, tenant_id) & {chunk.chunk_id for chunk in chunks_data}
    logger.info("RAG query completed", extra={"request_id": request_id, "trace_id": trace.id})
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
    flagged_chunk_ids: set[str] | None = None,
    request: Request | None = None,
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
        "flagged_chunk_ids": sorted(flagged_chunk_ids or set()),
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
                        retrieval_ready.set()
                        await events.put(
                            _sse_event(
                                "retrieval_complete",
                                {
                                    "chunk_ids": [chunk.chunk_id for chunk in chunks],
                                    "timings_ms": (node_update or {}).get("timings_ms", {}),
                                },
                            )
                        )
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
            if request is not None and await request.is_disconnected():
                break
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
        return

    finalized = _finalize_query_result(final_state, output_guardrails_enabled)
    final_answer = finalized.final_answer
    verification = finalized.verification
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
    db: AsyncSession = Depends(get_db),
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
            flagged_chunk_ids=await _review_flags(db, tenant_id),
            request=request,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
