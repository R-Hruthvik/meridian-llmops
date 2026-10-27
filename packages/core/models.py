"""Core Pydantic domain models for Meridian LLMOps platform."""

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class DocumentFormat(str, Enum):
    PDF = "pdf"
    MARKDOWN = "md"
    HTML = "html"
    DOCX = "docx"
    TXT = "txt"


class Document(BaseModel):
    """Represents a raw or parsed source document."""
    id: str = Field(..., description="Unique document identifier")
    title: str = Field(..., description="Document title")
    text: str = Field(..., description="Full text content of document")
    format: DocumentFormat = Field(DocumentFormat.TXT, description="File format")
    source: str = Field(..., description="Origin file path or URL")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Custom metadata attributes")


class Chunk(BaseModel):
    """A structurally parsed section or passage from a Document."""
    id: str = Field(..., description="Unique chunk identifier")
    document_id: str = Field(..., description="Associated document ID")
    text: str = Field(..., description="Text content of the chunk")
    chunk_index: int = Field(0, description="Ordinal position in document")
    section_heading: str | None = Field(default=None, description="Enclosing heading / section title")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Metadata payload")
    embedding: list[float] | None = Field(default=None, description="Dense vector embedding")

    def validate_dim(self, expected: int) -> "Chunk":
        if self.embedding is not None and len(self.embedding) != expected:
            raise ValueError(f"embedding dim {len(self.embedding)} != {expected}")
        return self


class Entity(BaseModel):
    """An entity node extracted for the Knowledge Graph."""
    name: str = Field(..., description="Normalized entity name / identifier")
    normalized_name: str = Field("", description="Case and punctuation normalized lookup key")
    entity_type: str = Field(..., description="Category (e.g. Concept, System, Component, Person)")
    properties: dict[str, Any] = Field(default_factory=dict, description="Entity attributes")
    document_ids: list[str] = Field(default_factory=list)
    chunk_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def set_normalized_name(self) -> "Entity":
        if not self.normalized_name:
            import re

            object.__setattr__(self, "normalized_name", " ".join(re.findall(r"\w+", self.name.casefold())))
        return self


class Relationship(BaseModel):
    """A directed relationship edge in the Knowledge Graph."""
    source_entity: str = Field(..., description="Source entity name")
    target_entity: str = Field(..., description="Target entity name")
    relation_type: str = Field(..., description="Relationship type (e.g. DEPENDS_ON, CONFIGURES)")
    properties: dict[str, Any] = Field(default_factory=dict, description="Edge attributes")
    document_ids: list[str] = Field(default_factory=list)
    chunk_ids: list[str] = Field(default_factory=list)


class SearchResult(BaseModel):
    """Result chunk returned by dense, sparse, or hybrid retrieval."""
    chunk_id: str
    document_id: str
    text: str
    score: float
    retrieval_method: str = Field("dense", description="dense, sparse_bm25, hybrid, or graph")
    metadata: dict[str, Any] = Field(default_factory=dict)
    rank: int | None = None
    filename: str = ""
    title: str = ""
    page_start: int | None = None
    heading_path: str = ""
    scores: dict[str, Any] = Field(default_factory=dict)
    chunk_index: int | None = None


class GuardrailResult(BaseModel):
    """Result of evaluating content against Input/Output guardrails."""
    allowed: bool = Field(..., description="Whether content passed guardrail policies")
    sanitized_text: str = Field(..., description="Sanitized/redacted text")
    policy_violations: list[str] = Field(default_factory=list, description="List of triggered violations")
    action_taken: str = Field("pass", description="pass, blocked, redacted, or transformed")


class IngestDocumentRequest(BaseModel):
    """Payload for the /v1/ingest endpoint."""
    text: str = Field(..., min_length=1, max_length=1_000_000, description="Document text content")
    title: str | None = Field(None, min_length=1, max_length=500, description="Optional document title")
    source: str | None = Field(None, description="Optional source identifier")
    metadata: dict[str, str] | None = Field(None, description="Optional key-value metadata")
    chunk_size: int | None = Field(None, ge=100, le=10000, description="Override default chunk size")
    chunk_overlap: int | None = Field(None, ge=0, le=1000, description="Override default chunk overlap")
    format: str | None = Field(None, pattern=r"^(md|txt|html)$", description="Text format hint")
    filename: str | None = Field(None, max_length=200, description="Optional filename for citations")


class UpdateLLMSettingsRequest(BaseModel):
    """Payload for the /v1/settings/llm endpoint. Unknown fields are rejected."""
    provider: str | None = Field(None, pattern=r"^[a-z0-9_-]+$", description="LLM provider identifier")
    api_key: str | None = None
    custom_api_key: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    groq_api_key: str | None = None
    openrouter_api_key: str | None = None
    deepseek_api_key: str | None = None
    ollama_api_key: str | None = None
    openai_base_url: str | None = None
    anthropic_base_url: str | None = None
    groq_base_url: str | None = None
    openrouter_base_url: str | None = None
    deepseek_base_url: str | None = None
    ollama_base_url: str | None = None
    custom_base_url: str | None = None
    active_provider: str | None = Field(None, pattern=r"^[a-z0-9_-]+$", description="Active LLM provider identifier")
    openai_org_id: str | None = None
    default_model: str | None = None
    model: str | None = None
    base_url: str | None = None
    timeout_seconds: int | None = Field(None, ge=1, le=300, description="Request timeout")
    enforce_guardrails: bool | None = None
    max_cycles: int | None = Field(None, ge=1, le=10, description="Maximum agent cycles")
    model_config = {"extra": "forbid"}

    @field_validator("provider", "api_key", "custom_api_key", "openai_api_key", "anthropic_api_key",
                     "groq_api_key", "openrouter_api_key", "deepseek_api_key", "ollama_api_key", "model", "base_url",
                     "active_provider", "openai_org_id", "default_model", "custom_base_url",
                     "openai_base_url", "anthropic_base_url", "groq_base_url", "openrouter_base_url", "deepseek_base_url", "ollama_base_url",
                     mode="before")
    @classmethod
    def empty_string_to_none(cls, v):
        if v == "":
            return None
        return v


def _default_retrieval_top_k() -> int:
    from packages.core.settings import get_settings

    return get_settings().retrieval_default_top_k


def _default_max_cycles() -> int:
    from packages.core.settings import get_settings

    return get_settings().max_cycles


class QueryRequest(BaseModel):
    """User query payload."""
    query: str = Field(..., min_length=1, max_length=10_000, description="User search or prompt query")
    tenant_id: str = Field("default", description="Tenant or client identifier")
    top_k: int = Field(default_factory=_default_retrieval_top_k, ge=1, le=20, description="Number of chunks to retrieve")
    max_cycles: int = Field(default_factory=_default_max_cycles, ge=1, le=4, description="Maximum total retrieval and generation attempts")
    enforce_guardrails: bool = Field(True, description="Whether to enforce input/output rails")
    session_id: str | None = Field(None, description="Session ID for conversation grouping")


class ServingProvenance(BaseModel):
    """Who actually served this response. Nulls mean no LLM produced the answer."""

    provider: str | None = Field(None, description="Provider that actually served the request, or null when no LLM served it")
    model: str | None = Field(None, description="Model the upstream reported it served (may differ from what was requested), or null when no LLM served it")
    fresh: bool = Field(False, description="True only when this request's own upstream call returned non-empty content attributed to the fields above")


class VerificationSummary(BaseModel):
    """Verification outcome exposed by the query API."""

    status: Literal["citations_ok", "citations_failed", "supported", "unsupported", "unchecked"] = Field(
        "unchecked", description="Verification status; citations statuses describe format and numeric consistency only"
    )
    scope: Literal["format_and_numeric_consistency", "llm_judgment", "unchecked"] = Field(
        "unchecked", description="What the verification outcome assesses"
    )
    invalid_citations: list[int] = Field(default_factory=list)
    uncited_claims: list[str] = Field(default_factory=list)
    numeric_mismatches: list[str] = Field(default_factory=list)
    unsupported_claims: list[str] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    details: str | None = None


class ReviewStatus(BaseModel):
    """Review-queue signals attached to one query response (issue #67)."""

    flagged_chunk_ids: list[str] = Field(
        default_factory=list,
        description="Reviewer-flagged chunks among this response's sources; empty when none",
    )


class QueryResponse(BaseModel):
    """Unified system response payload."""
    query: str
    answer: str
    source_chunks: list[SearchResult] = Field(default_factory=list)
    entities: list[Entity] = Field(default_factory=list)
    cycle_count: int = Field(1, description="Number of LangGraph cycles executed")
    verified: bool = Field(False, description="Deprecated; true only when verification.status is supported")
    refusal: bool = Field(False, description="Whether the response is a safe refusal fallback")
    execution_time_ms: float = Field(0.0, description="Total latency in milliseconds")
    degraded_reason: str | None = Field(None, description="Why this response was produced on a degraded path (e.g. LLM generation failed); null when a normal generation succeeded")
    serving_provider: str | None = Field("openai", description="Upstream LLM provider that generated the response; null when no LLM served it")
    serving_model: str | None = Field("gpt-4o-mini", description="Model that generated the response as reported upstream; null when no LLM served it")
    serving: ServingProvenance = Field(default_factory=ServingProvenance, description="Explicit serving provenance; the authoritative signal for issue #35")
    answer_status: str = Field("answered", description="answered or insufficient_context")
    verification: VerificationSummary = Field(default_factory=VerificationSummary)
    debug: dict[str, Any] = Field(default_factory=dict)
    sources: list[SearchResult] = Field(default_factory=list)
    request_id: str | None = None
    trace_id: str | None = Field(None, description="Observability trace id for end-to-end audit; null when untraced")
    review_status: ReviewStatus = Field(
        default_factory=ReviewStatus, description="Review-queue audit signals for this response (issue #67)"
    )
    provider: str | None = None
    model: str | None = None
    timings_ms: dict[str, float] = Field(default_factory=dict)
    usage: dict[str, Any] | None = None


class BackendHealth(BaseModel):
    """Live reachability of one storage subsystem, as observed by a real query."""

    reachable: bool = Field(..., description="True only when the real backend answered a live query")
    is_fallback: bool = Field(..., description="True when the subsystem is served by an in-process fallback")
    endpoint: str = Field(..., description="Configured endpoint for this subsystem")
    detail: str = Field(..., description="Human-readable explanation of the observed state")


class VectorIndexStatus(BaseModel):
    """Dense vector index state (Qdrant, or the in-memory fallback cache)."""

    collections: list[str] = Field(default_factory=list, description="Collection names read live; empty when no live client is in use")
    points_per_collection: dict[str, int] = Field(default_factory=dict, description="Live point count per collection")
    total_points: int | None = Field(None, description="Total live points, or in-process chunk count when falling back")
    vector_dimension: int | None = Field(None, description="Embedding dimension reported by the live collection")
    is_fallback: bool = Field(False, description="Always false; dense retrieval uses the configured Qdrant backend")
    detail: str = Field("", description="How these numbers were obtained")


class GraphIndexStatus(BaseModel):
    """Knowledge graph state (Neo4j, or the in-memory fallback graph)."""

    node_count: int | None = Field(None, description="Node count read live; null when Neo4j is unreachable")
    relationship_count: int | None = Field(None, description="Relationship count read live; null when Neo4j is unreachable")
    entity_index_size: int | None = Field(None, description="Entities held by the live entity lookup index")
    is_fallback: bool = Field(False, description="True when no live Neo4j driver is in use")
    detail: str = Field("", description="How these numbers were obtained")


class LexicalIndexStatus(BaseModel):
    """BM25 sparse index state, read from the live retriever."""

    corpus_size: int | None = Field(None, description="Chunks currently held by the BM25 index")
    document_count: int | None = Field(None, description="Distinct documents represented in the BM25 corpus")
    is_fallback: bool = Field(False, description="True when the lexical index could not be read")
    detail: str = Field("", description="How these numbers were obtained")


class TableRowCount(BaseModel):
    """One live relational table and its row count."""

    name: str = Field(..., description="Table name as reported by the live database")
    row_count: int = Field(..., description="Rows counted with SELECT COUNT(*)")


class RelationalIndexStatus(BaseModel):
    """Relational storage state (SQLite/SQLAlchemy), read live."""

    dialect: str | None = Field(None, description="SQL dialect reported by the live connection")
    tables: list[TableRowCount] = Field(default_factory=list, description="Live tables and their row counts")
    total_rows: int = Field(0, description="Sum of the listed table row counts")
    is_fallback: bool = Field(False, description="True when the relational store could not be reached")
    detail: str = Field("", description="How these numbers were obtained")


class IndexStatusResponse(BaseModel):
    """Live Index & Storage inspection across every backing subsystem."""

    vector: VectorIndexStatus = Field(..., description="Qdrant dense vector index")
    graph: GraphIndexStatus = Field(..., description="Neo4j knowledge graph")
    lexical: LexicalIndexStatus = Field(..., description="BM25 sparse index")
    relational: RelationalIndexStatus = Field(..., description="SQLite/SQLAlchemy relational storage")
    backends: dict[str, BackendHealth] = Field(default_factory=dict, description="Per-subsystem reachability for Online/Degraded/Offline rendering")


# =====================================================================
# Backward-compatible re-exports for the ORM models (issue #66)
# =====================================================================
# The SQLAlchemy ORM models now live in packages.core.db_models; they are
# re-exported here so existing ``from packages.core.models import <ORM model>``
# call sites keep working during the transition. New code should import from
# packages.core.db_models directly.

from packages.core.db_models import (  # noqa: F401
    Base,
    ExtractedField,
    ORMAnswer,
    ORMChunk,
    ORMCitation,
    ORMClaim,
    ORMDocument,
    ReviewItem,
)

