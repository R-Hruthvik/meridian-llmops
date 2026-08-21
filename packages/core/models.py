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
    serving_provider: str = Field("openai", description="Upstream LLM provider that generated the response")
    serving_model: str = Field("gpt-4o-mini", description="Specific model that generated the response")


# =====================================================================
# SQLAlchemy 2.0 ORM Models for Persistence & Human-in-the-Loop Review
# =====================================================================

import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, Float, Integer, DateTime, ForeignKey, JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class ORMDocument(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[str] = mapped_column(String(50), nullable=False)
    source_uri: Mapped[str] = mapped_column(String(512), nullable=True)
    processing_status: Mapped[str] = mapped_column(String(50), default="processed")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    chunks: Mapped[list["ORMChunk"]] = relationship("ORMChunk", back_populates="document", cascade="all, delete-orphan")
    extracted_fields: Mapped[list["ExtractedField"]] = relationship("ExtractedField", back_populates="document", cascade="all, delete-orphan")


class ORMChunk(Base):
    __tablename__ = "chunks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str] = mapped_column(String(36), ForeignKey("documents.id"), nullable=False)
    chunk_type: Mapped[str] = mapped_column(String(50), default="text")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    page: Mapped[int] = mapped_column(Integer, default=1)
    section: Mapped[str] = mapped_column(String(255), default="General")
    bbox: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    embedding_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    document: Mapped["ORMDocument"] = relationship("ORMDocument", back_populates="chunks")


class ExtractedField(Base):
    __tablename__ = "extracted_fields"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str] = mapped_column(String(36), ForeignKey("documents.id"), nullable=False)
    field_name: Mapped[str] = mapped_column(String(255), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    provenance_chunk_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    provenance_page: Mapped[int] = mapped_column(Integer, default=1)
    review_status: Mapped[str] = mapped_column(String(50), default="auto_approved")

    document: Mapped["ORMDocument"] = relationship("ORMDocument", back_populates="extracted_fields")
    review_item: Mapped["ReviewItem | None"] = relationship("ReviewItem", back_populates="extracted_field", uselist=False)


class ReviewItem(Base):
    __tablename__ = "review_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    extracted_field_id: Mapped[str] = mapped_column(String(36), ForeignKey("extracted_fields.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="pending")  # pending, approved, rejected, corrected
    corrected_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    extracted_field: Mapped["ExtractedField"] = relationship("ExtractedField", back_populates="review_item")


class ORMAnswer(Base):
    __tablename__ = "answers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    query_text: Mapped[str] = mapped_column(Text, nullable=False)
    answer_text: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    status: Mapped[str] = mapped_column(String(50), default="verified")
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    claims: Mapped[list["ORMClaim"]] = relationship("ORMClaim", back_populates="answer", cascade="all, delete-orphan")


class ORMClaim(Base):
    __tablename__ = "claims"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    answer_id: Mapped[str] = mapped_column(String(36), ForeignKey("answers.id"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    verification_status: Mapped[str] = mapped_column(String(50), default="supported")

    answer: Mapped["ORMAnswer"] = relationship("ORMAnswer", back_populates="claims")
    citations: Mapped[list["ORMCitation"]] = relationship("ORMCitation", back_populates="claim", cascade="all, delete-orphan")


class ORMCitation(Base):
    __tablename__ = "citations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    claim_id: Mapped[str] = mapped_column(String(36), ForeignKey("claims.id"), nullable=False)
    chunk_id: Mapped[str] = mapped_column(String(36), nullable=False)
    quote: Mapped[str] = mapped_column(Text, nullable=False)
    support_score: Mapped[float] = mapped_column(Float, default=1.0)
    verification_status: Mapped[str] = mapped_column(String(50), default="supported")

    claim: Mapped["ORMClaim"] = relationship("ORMClaim", back_populates="citations")

