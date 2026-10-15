"""SQLAlchemy 2.0 ORM models for Meridian LLMOps persistence.

These models back the relational store (parsed documents and chunks, extracted
fields awaiting human review, and verified answers with their claims and
citations). They are kept separate from the Pydantic API schemas in
``packages.core.models`` (see issue #66).
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

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
