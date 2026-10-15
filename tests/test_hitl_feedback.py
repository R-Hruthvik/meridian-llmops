"""Issue #67: connect HITL review corrections to golden export and retrieval scoring."""

import json
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from packages.core.db_models import Base, ExtractedField, ORMDocument, ReviewItem
from packages.core.schemas import GoldenCase
from scripts.validate_golden import validate_dataset
from services.rag_engine.routers.review import (
    build_golden_case,
    export_golden_cases,
    review_flagged_chunk_ids,
)


@pytest_asyncio.fixture
async def test_db_session():
    test_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    TestSession = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with TestSession() as session:
        yield session

    await test_engine.dispose()


def _seed_rows() -> tuple[ORMDocument, ExtractedField, ReviewItem]:
    document = ORMDocument(id="doc_1", title="Spend Policy", file_type="md", source_uri="sample_docs/policy.md")
    field = ExtractedField(
        id="field_1",
        document_id="doc_1",
        field_name="max_spend_limit",
        value="$500",
        confidence=0.72,
        provenance_chunk_id="chunk_9",
        provenance_page=2,
        review_status="corrected",
    )
    item = ReviewItem(
        id="item_1",
        extracted_field_id="field_1",
        status="corrected",
        corrected_value="$750",
        notes="Finance corrected the ceiling.",
    )
    return document, field, item


def test_build_golden_case_maps_verified_item_to_golden_schema():
    document, field, item = _seed_rows()

    case = build_golden_case(item, field, document)

    assert isinstance(case, GoldenCase)
    assert case.id == "review-item_1"
    assert case.category in {"factual", "numeric", "paraphrase", "identifier", "near_duplicate", "multi_chunk"}
    assert case.answerable is True
    assert case.expected_doc == "policy.md"
    assert case.expected_phrases == ["$750"]
    assert case.notes


def test_exported_golden_cases_validate_against_golden_dataset_schema(tmp_path: Path):
    document, field, item = _seed_rows()
    case = build_golden_case(item, field, document)

    docs = tmp_path / "sample_docs"
    docs.mkdir()
    (docs / "policy.md").write_text("The maximum spend limit for a single order is $750.")
    dataset = tmp_path / "review_golden.json"
    dataset.write_text(json.dumps([case.model_dump()]))

    assert validate_dataset(dataset, docs) == []


@pytest.mark.asyncio
async def test_export_endpoint_returns_only_verified_items(test_db_session: AsyncSession):
    document, field, item = _seed_rows()
    pending_doc = ORMDocument(id="doc_2", title="Old Doc", file_type="md", source_uri="sample_docs/old.md")
    pending_field = ExtractedField(
        id="field_2",
        document_id="doc_2",
        field_name="owner",
        value="unknown",
        confidence=0.4,
        provenance_chunk_id="chunk_10",
        provenance_page=1,
        review_status="pending",
    )
    pending_item = ReviewItem(id="item_2", extracted_field_id="field_2", status="pending")
    test_db_session.add_all([document, field, item, pending_doc, pending_field, pending_item])
    await test_db_session.commit()

    cases = await export_golden_cases(db=test_db_session, tenant_id="ops")

    assert [case.id for case in cases] == ["review-item_1"]
    assert cases[0].expected_phrases == ["$750"]


@pytest.mark.asyncio
async def test_flagged_chunk_ids_cover_rejected_and_corrected_items(test_db_session: AsyncSession):
    document, field, item = _seed_rows()
    rejected_field = ExtractedField(
        id="field_3",
        document_id="doc_1",
        field_name="vendor",
        value="Acme",
        confidence=0.3,
        provenance_chunk_id="chunk_7",
        provenance_page=4,
        review_status="rejected",
    )
    rejected_item = ReviewItem(id="item_3", extracted_field_id="field_3", status="rejected")
    approved_field = ExtractedField(
        id="field_4",
        document_id="doc_1",
        field_name="currency",
        value="USD",
        confidence=0.99,
        provenance_chunk_id="chunk_5",
        provenance_page=1,
        review_status="approved",
    )
    approved_item = ReviewItem(id="item_4", extracted_field_id="field_4", status="approved")
    test_db_session.add_all([document, field, item, rejected_field, rejected_item, approved_field, approved_item])
    await test_db_session.commit()

    flagged = await review_flagged_chunk_ids(test_db_session)

    assert flagged == {"chunk_9", "chunk_7"}
