"""State schema for LangGraph cyclic RAG execution."""

from typing import Any, TypedDict


class RagAgentState(TypedDict):
    """The central state passed across LangGraph nodes."""
    query: str
    current_search_query: str
    retrieved_chunks: list[dict[str, Any]]
    entities: list[dict[str, Any]]
    draft_answer: str
    critic_verdict: dict[str, Any] | None
    cycle_count: int
    max_cycles: int
    is_grounded: bool
    is_refusal: bool
    tenant_id: str
    claims: list[dict[str, Any]]
    verification_result: dict[str, Any] | None
    generation_error: str | None
    answer_status: str
    timings_ms: dict[str, float]
    request_id: str
    serving_provider: str | None
    serving_model: str | None
    usage: dict[str, Any] | None

