"""Core Pydantic domain models for Meridian LLMOps platform."""

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


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


class Entity(BaseModel):
    """An entity node extracted for the Knowledge Graph."""
    name: str = Field(..., description="Normalized entity name / identifier")
    entity_type: str = Field(..., description="Category (e.g. Concept, System, Component, Person)")
    properties: dict[str, Any] = Field(default_factory=dict, description="Entity attributes")


class Relationship(BaseModel):
    """A directed relationship edge in the Knowledge Graph."""
    source_entity: str = Field(..., description="Source entity name")
    target_entity: str = Field(..., description="Target entity name")
    relation_type: str = Field(..., description="Relationship type (e.g. DEPENDS_ON, CONFIGURES)")
    properties: dict[str, Any] = Field(default_factory=dict, description="Edge attributes")


class SearchResult(BaseModel):
    """Result chunk returned by dense, sparse, or hybrid retrieval."""
    chunk_id: str
    document_id: str
    text: str
    score: float
    retrieval_method: str = Field("dense", description="dense, sparse_bm25, hybrid_rrf, or graph")
    metadata: dict[str, Any] = Field(default_factory=dict)


class CriticVerdict(BaseModel):
    """Verdict rendered by the Critic Agent (LLM-as-a-judge)."""
    is_grounded: bool = Field(..., description="True if response is fully supported by retrieved context")
    confidence_score: float = Field(..., ge=0.0, le=1.0, description="Confidence in grounding verdict")
    unsupported_claims: list[str] = Field(default_factory=list, description="Claims flagged as ungrounded")
    reasoning: str = Field(..., description="Explanation of evaluation decision")


class GuardrailResult(BaseModel):
    """Result of evaluating content against Input/Output guardrails."""
    allowed: bool = Field(..., description="Whether content passed guardrail policies")
    sanitized_text: str = Field(..., description="Sanitized/redacted text")
    policy_violations: list[str] = Field(default_factory=list, description="List of triggered violations")
    action_taken: str = Field("pass", description="pass, blocked, redacted, or transformed")


class QueryRequest(BaseModel):
    """User query payload."""
    query: str = Field(..., min_length=1, description="User search or prompt query")
    tenant_id: str = Field("default", description="Tenant or client identifier")
    top_k: int = Field(5, ge=1, le=50, description="Number of candidate chunks to retrieve")
    max_cycles: int = Field(3, ge=1, le=5, description="Maximum self-healing retry cycles")
    enforce_guardrails: bool = Field(True, description="Whether to enforce input/output rails")


class QueryResponse(BaseModel):
    """Unified system response payload."""
    query: str
    answer: str
    source_chunks: list[SearchResult] = Field(default_factory=list)
    entities: list[Entity] = Field(default_factory=list)
    cycle_count: int = Field(1, description="Number of LangGraph cycles executed")
    verified: bool = Field(True, description="Whether the response passed Critic verification")
    refusal: bool = Field(False, description="Whether the response is a safe refusal fallback")
    execution_time_ms: float = Field(0.0, description="Total latency in milliseconds")
