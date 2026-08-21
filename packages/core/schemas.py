"""Pydantic schemas for citation verification, claim models, and human review items."""

from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class CitationSchema(BaseModel):
    """Citation pointing to source chunk quote and support score."""
    chunk_id: str
    document_id: Optional[str] = None
    page: int = 1
    section: str = "General"
    quote: str
    support_score: float = Field(ge=0.0, le=1.0)
    verification_status: str = "supported"  # supported, partially_supported, unsupported


class ClaimSchema(BaseModel):
    """Atomic claim extracted from generated answer with supporting citations."""
    text: str
    citations: List[CitationSchema] = []
    verification_status: str = "supported"  # supported, partially_supported, unsupported


class VerificationResult(BaseModel):
    """Result payload from the 3-Tier Citation Verification Engine."""
    claims: List[ClaimSchema]
    overall_status: str = "supported"  # supported, partially_supported, unsupported
    overall_confidence: float = 1.0


class ReviewItemResponse(BaseModel):
    """Response DTO for queued low-confidence items in Human Review Queue."""
    id: str
    extracted_field_id: str
    document_id: str
    field_name: str
    value: str
    confidence: float
    provenance_page: int
    status: str  # pending, approved, rejected, corrected
    corrected_value: Optional[str] = None
    notes: Optional[str] = None


class ReviewItemAction(BaseModel):
    """Payload for approving, rejecting, or correcting a review item."""
    action: str  # approve, reject, correct
    corrected_value: Optional[str] = None
    notes: Optional[str] = None
