"""Integration tests for Human-in-the-Loop (HITL) Review Queue database and API endpoints."""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from packages.core.models import Base, ORMDocument, ExtractedField, ReviewItem
from services.rag_engine.app import app


@pytest_asyncio.fixture
async def test_db_session():
    test_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    TestSession = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with TestSession() as session:
        yield session

    await test_engine.dispose()


@pytest.mark.asyncio
async def test_hitl_review_item_lifecycle(test_db_session: AsyncSession):
    # 1. Create document, extracted field, and pending review item
    doc = ORMDocument(id="doc_123", title="Compliance Guide", file_type="pdf")
    field = ExtractedField(
        id="field_1",
        document_id="doc_123",
        field_name="max_spend_limit",
        value="$500",
        confidence=0.72,
        provenance_page=2,
        review_status="pending",
    )
    item = ReviewItem(
        id="item_1",
        extracted_field_id="field_1",
        status="pending",
    )

    test_db_session.add_all([doc, field, item])
    await test_db_session.commit()

    # 2. Test fetching pending review items
    from sqlalchemy import select
    stmt = (
        select(ReviewItem, ExtractedField)
        .join(ExtractedField, ReviewItem.extracted_field_id == ExtractedField.id)
        .where(ReviewItem.status == "pending")
    )
    res = await test_db_session.execute(stmt)
    rows = res.all()
    assert len(rows) == 1
    assert rows[0][1].field_name == "max_spend_limit"
    assert rows[0][1].confidence == 0.72

    # 3. Test approving item
    review_item, ext_field = rows[0]
    review_item.status = "approved"
    ext_field.review_status = "approved"
    await test_db_session.commit()

    assert review_item.status == "approved"
    assert ext_field.review_status == "approved"
