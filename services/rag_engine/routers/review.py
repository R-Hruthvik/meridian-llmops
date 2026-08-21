"""Human-in-the-Loop (HITL) Review Queue router for low-confidence extractions."""

from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from packages.core.db import get_db
from packages.core.models import ReviewItem, ExtractedField
from packages.core.schemas import ReviewItemResponse, ReviewItemAction

router = APIRouter(prefix="/v1/review", tags=["Human Review Queue"])


@router.get("/items", response_model=List[ReviewItemResponse])
async def list_pending_review_items(db: AsyncSession = Depends(get_db)):
    """Lists all pending low-confidence items in the Human Review Queue."""
    stmt = (
        select(ReviewItem, ExtractedField)
        .join(ExtractedField, ReviewItem.extracted_field_id == ExtractedField.id)
        .where(ReviewItem.status == "pending")
    )
    result = await db.execute(stmt)
    rows = result.all()

    items = []
    for item, field in rows:
        items.append(ReviewItemResponse(
            id=item.id,
            extracted_field_id=field.id,
            document_id=field.document_id,
            field_name=field.field_name,
            value=field.value,
            confidence=field.confidence,
            provenance_page=field.provenance_page,
            status=item.status,
            corrected_value=item.corrected_value,
            notes=item.notes
        ))

    return items


@router.post("/items/{item_id}/action", response_model=ReviewItemResponse)
async def process_review_action(
    item_id: str,
    action_data: ReviewItemAction,
    db: AsyncSession = Depends(get_db)
):
    """Processes approval, rejection, or correction of a queued review item."""
    stmt = (
        select(ReviewItem, ExtractedField)
        .join(ExtractedField, ReviewItem.extracted_field_id == ExtractedField.id)
        .where(ReviewItem.id == item_id)
    )
    result = await db.execute(stmt)
    row = result.first()

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review item not found")

    item, field = row
    action = action_data.action.lower()

    if action == "approve":
        item.status = "approved"
        field.review_status = "approved"
    elif action == "reject":
        item.status = "rejected"
        field.review_status = "rejected"
    elif action == "correct":
        if not action_data.corrected_value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Corrected value required")
        item.status = "corrected"
        item.corrected_value = action_data.corrected_value
        field.value = action_data.corrected_value
        field.review_status = "corrected"
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid action")

    item.notes = action_data.notes
    item.reviewed_at = datetime.now(timezone.utc)
    await db.commit()

    return ReviewItemResponse(
        id=item.id,
        extracted_field_id=field.id,
        document_id=field.document_id,
        field_name=field.field_name,
        value=field.value,
        confidence=field.confidence,
        provenance_page=field.provenance_page,
        status=item.status,
        corrected_value=item.corrected_value,
        notes=item.notes
    )
