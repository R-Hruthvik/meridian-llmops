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
