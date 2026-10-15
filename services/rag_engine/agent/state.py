"""Typed state schema for LangGraph cyclic RAG execution."""

from typing import Any, Literal, TypedDict

from packages.core.models import Entity, SearchResult
from services.rag_engine.verification import VerificationResult


class RagAgentState(TypedDict, total=False):
    query: str
    current_search_query: str
    retrieved_chunks: list[SearchResult]
    entities: list[Entity]
    graph_context: list[dict[str, Any]]
    draft_answer: str
    cycle_count: int
    max_cycles: int
    tenant_id: str
    flagged_chunk_ids: list[str]
    answer_status: Literal["answered", "insufficient_context", "unverified", "refused"]
    verification_result: VerificationResult | None
    timings_ms: dict[str, float]
    request_id: str
    serving_provider: str | None
    serving_model: str | None
    usage: dict[str, Any] | None
    generation_error: str | None
    is_refusal: bool
    debug: dict[str, Any]
    retry_top_k: int
    base_top_k: int
