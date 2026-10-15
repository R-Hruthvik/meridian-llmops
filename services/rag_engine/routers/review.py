"""Human-in-the-Loop (HITL) Review Queue router for low-confidence extractions."""

from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from packages.core.db_models import ExtractedField, ORMChunk, ORMDocument, ReviewItem
from packages.core.schemas import GoldenCase, ReviewItemAction, ReviewItemResponse
from services.rag_engine.deps import get_db, require_admin

router = APIRouter(prefix="/v1/review", tags=["Human Review Queue"])

# Verified review outcomes: a human confirmed the extracted value (approved) or
# supplied the ground truth (corrected). Both are exportable as golden cases.
VERIFIED_REVIEW_STATUSES = ("approved", "corrected")
# Export category used for review-derived golden cases; the retrieval golden
# schema (evals/golden_dataset.json) requires one of its known categories.
EXPORTED_GOLDEN_CATEGORY = "factual"


def build_golden_case(item: ReviewItem, field: ExtractedField, document: ORMDocument) -> GoldenCase:
    """Map one verified review item to the retrieval golden-dataset schema."""
    phrase = item.corrected_value or field.value
    source = document.source_uri or document.title
    return GoldenCase(
        id=f"review-{item.id}",
        category=EXPORTED_GOLDEN_CATEGORY,
        question=f"What is the {field.field_name.replace('_', ' ')} for {document.title}?",
        answerable=True,
        expected_doc=Path(source).name,
        expected_phrases=[phrase],
        notes=item.notes or f"Human-verified {field.field_name} from review item {item.id}.",
    )


@router.get("/items", response_model=list[ReviewItemResponse])
async def list_pending_review_items(
    db: AsyncSession = Depends(get_db),
    tenant_id: str = Depends(require_admin),
):
    """Lists all pending low-confidence items in the Human Review Queue."""
    stmt = (
        select(ReviewItem, ExtractedField)
        .join(ExtractedField, ReviewItem.extracted_field_id == ExtractedField.id)
        .join(ORMDocument, ExtractedField.document_id == ORMDocument.id)
        .where(ReviewItem.status == "pending", ORMDocument.tenant_id == tenant_id)
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
    db: AsyncSession = Depends(get_db),
    tenant_id: str = Depends(require_admin),
):
    """Processes approval, rejection, or correction of a queued review item."""
    stmt = (
        select(ReviewItem, ExtractedField)
        .join(ExtractedField, ReviewItem.extracted_field_id == ExtractedField.id)
        .join(ORMDocument, ExtractedField.document_id == ORMDocument.id)
        .where(ReviewItem.id == item_id, ORMDocument.tenant_id == tenant_id)
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
    item.reviewed_at = datetime.now(UTC)
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


@router.get("/golden-export", response_model=list[GoldenCase])
async def export_golden_cases(
    db: AsyncSession = Depends(get_db),
    tenant_id: str = Depends(require_admin),
):
    """Exports verified review corrections as evaluation-compatible golden cases.

    Verified outcomes are ``approved`` and ``corrected`` review items; each is
    mapped to the schema consumed by ``evals/eval_retrieval.py``.
    """
    stmt = (
        select(ReviewItem, ExtractedField, ORMDocument)
        .join(ExtractedField, ReviewItem.extracted_field_id == ExtractedField.id)
        .join(ORMDocument, ExtractedField.document_id == ORMDocument.id)
        .where(
            ReviewItem.status.in_(VERIFIED_REVIEW_STATUSES),
            ORMDocument.tenant_id == tenant_id,
        )
    )
    result = await db.execute(stmt)
    cases = []
    for item, field, document in result.all():
        case = build_golden_case(item, field, document)
        chunk_result = await db.execute(
            select(ORMChunk.content).where(ORMChunk.document_id == document.id)
        )
        source_chunks = chunk_result.scalars().all()
        phrase = " ".join(case.expected_phrases[0].casefold().split())
        if phrase and any(phrase in " ".join(chunk.casefold().split()) for chunk in source_chunks):
            cases.append(case)
    return cases


async def review_flagged_chunk_ids(db: AsyncSession, tenant_id: str) -> set[str]:
    """Return chunk ids whose extraction a reviewer rejected or corrected.

    These chunks carry degraded authority: their content produced a wrong
    extraction, so retrieval should rank them below equally-scored peers.
    """
    stmt = (
        select(ExtractedField.provenance_chunk_id)
        .join(ReviewItem, ReviewItem.extracted_field_id == ExtractedField.id)
        .join(ORMDocument, ExtractedField.document_id == ORMDocument.id)
        .where(
            ReviewItem.status.in_(("rejected", "corrected")),
            ExtractedField.provenance_chunk_id.is_not(None),
            ORMDocument.tenant_id == tenant_id,
        )
    )
    result = await db.execute(stmt)
    return {chunk_id for chunk_id in result.scalars().all() if chunk_id}
