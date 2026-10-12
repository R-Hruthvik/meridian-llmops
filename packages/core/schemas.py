"""Pydantic schemas for human review items."""

from pydantic import BaseModel


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
    corrected_value: str | None = None
    notes: str | None = None


class ReviewItemAction(BaseModel):
    """Payload for approving, rejecting, or correcting a review item."""
    action: str  # approve, reject, correct
    corrected_value: str | None = None
    notes: str | None = None
