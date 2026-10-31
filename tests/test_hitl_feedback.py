"""Issue #67: connect HITL review corrections to golden export and retrieval scoring."""

import json
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from packages.core.db_models import Base, ExtractedField, ORMChunk, ORMDocument, ReviewItem
from packages.core.models import Chunk, QueryResponse
from packages.core.schemas import GoldenCase
from scripts.validate_golden import validate_dataset
from services.rag_engine.retrieval.bm25 import BM25Index
from services.rag_engine.retrieval.hybrid import FLAGGED_CHUNK_PENALTY, HybridRetriever
from services.rag_engine.routers.review import (
    build_golden_case,
    export_golden_cases,
    review_flagged_chunk_ids,
)
from tests.fakes import FakeEmbedder, make_vector_store


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
    document = ORMDocument(
        id="doc_1", title="Spend Policy", file_type="md", source_uri="sample_docs/policy.md"
    )
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
    assert case.category in {
        "factual",
        "numeric",
        "paraphrase",
        "identifier",
        "near_duplicate",
        "multi_chunk",
    }
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
    pending_doc = ORMDocument(
        id="doc_2", title="Old Doc", file_type="md", source_uri="sample_docs/old.md"
    )
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
    test_db_session.add_all(
        [
            document,
            field,
            item,
            ORMChunk(id="chunk_9", document_id="doc_1", content="The reviewed limit is $750."),
            pending_doc,
            pending_field,
            pending_item,
        ]
    )
    await test_db_session.commit()

    cases = await export_golden_cases(db=test_db_session, tenant_id="default")

    assert [case.id for case in cases] == ["review-item_1"]
    assert cases[0].expected_phrases == ["$750"]


@pytest.mark.asyncio
async def test_export_skips_corrected_values_absent_from_source_chunks(
    test_db_session: AsyncSession,
):
    document, field, item = _seed_rows()
    impossible_field = ExtractedField(
        id="field_impossible",
        document_id="doc_1",
        field_name="unsupported_limit",
        value="$9999",
        confidence=0.2,
        provenance_chunk_id="chunk_impossible",
    )
    impossible_item = ReviewItem(
        id="item_impossible",
        extracted_field_id="field_impossible",
        status="corrected",
        corrected_value="$9999",
    )
    test_db_session.add_all(
        [
            document,
            field,
            item,
            impossible_field,
            impossible_item,
            ORMChunk(id="chunk_9", document_id="doc_1", content="The reviewed limit is $750."),
            ORMChunk(
                id="chunk_impossible", document_id="doc_1", content="The reviewed limit is $750."
            ),
        ]
    )
    await test_db_session.commit()

    cases = await export_golden_cases(db=test_db_session, tenant_id="default")

    assert [case.id for case in cases] == ["review-item_1"]


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
    test_db_session.add_all(
        [document, field, item, rejected_field, rejected_item, approved_field, approved_item]
    )
    await test_db_session.commit()

    flagged = await review_flagged_chunk_ids(test_db_session, "default")

    assert flagged == {"chunk_9", "chunk_7"}


@pytest.mark.asyncio
async def test_flagged_chunk_ids_are_scoped_to_document_tenant(test_db_session: AsyncSession):
    document, field, item = _seed_rows()
    other_document = ORMDocument(
        id="doc_other", title="Other tenant", file_type="md", tenant_id="other"
    )
    other_field = ExtractedField(
        id="field_other",
        document_id="doc_other",
        field_name="limit",
        value="$1",
        confidence=0.2,
        provenance_chunk_id="chunk_other",
    )
    other_item = ReviewItem(id="item_other", extracted_field_id="field_other", status="rejected")
    test_db_session.add_all([document, field, item, other_document, other_field, other_item])
    await test_db_session.commit()

    assert await review_flagged_chunk_ids(test_db_session, "default") == {"chunk_9"}
    assert await review_flagged_chunk_ids(test_db_session, "other") == {"chunk_other"}


def _build_retriever(chunks: list[Chunk]) -> HybridRetriever:
    embedder = FakeEmbedder()
    vector_store = make_vector_store(embedder)
    vector_store.upsert_chunks(chunks, embedder.embed_passages([chunk.text for chunk in chunks]))
    return HybridRetriever(
        embedder=embedder, vector_store=vector_store, bm25_index=BM25Index(chunks)
    )


def _penalty_chunks() -> list[Chunk]:
    return [
        Chunk(
            id="c1",
            document_id="d1",
            text="Meridian routes queries through LiteLLM to every provider.",
            metadata={"filename": "arch.md", "page_start": 1},
        ),
        Chunk(
            id="c2",
            document_id="d1",
            text="Meridian routes queries through LiteLLM to every provider.",
            metadata={"filename": "arch.md", "page_start": 2},
        ),
        Chunk(
            id="c3",
            document_id="d2",
            text="Unrelated billing reconciliation note.",
            metadata={"filename": "b.md", "page_start": 1},
        ),
    ]


def test_retriever_applies_no_penalty_without_flags():
    retriever = _build_retriever(_penalty_chunks())
    result = retriever.retrieve("Meridian routes queries through LiteLLM", top_k=3)
    assert [chunk.scores["review_penalty"] for chunk in result.chunks] == [1.0, 1.0, 1.0]


def test_flagged_chunk_scores_lower_and_reranks():
    retriever = _build_retriever(_penalty_chunks())
    baseline = retriever.retrieve("Meridian routes queries through LiteLLM", top_k=3)
    top = baseline.chunks[0]

    penalized = retriever.retrieve(
        "Meridian routes queries through LiteLLM", top_k=3, flagged_chunk_ids={top.chunk_id}
    )
    by_id = {chunk.chunk_id: chunk for chunk in penalized.chunks}

    assert by_id[top.chunk_id].scores["review_penalty"] == FLAGGED_CHUNK_PENALTY
    assert by_id[top.chunk_id].scores["final"] == pytest.approx(
        top.scores["final"] * FLAGGED_CHUNK_PENALTY
    )
    # The identical, unflagged peer overtakes the penalized chunk.
    assert penalized.chunks[0].chunk_id != top.chunk_id
    finals = [chunk.scores["final"] for chunk in penalized.chunks]
    assert finals == sorted(finals, reverse=True)


def test_flagged_negative_logit_moves_down():
    penalized = HybridRetriever._penalize({"final": -8.0, "rerank": -8.0})

    assert penalized["final"] == -12.0
    assert penalized["final"] < -7.0


def test_query_response_defaults_keep_backward_compatibility():
    response = QueryResponse(query="q", answer="a")

    assert response.trace_id is None
    assert response.review_status.flagged_chunk_ids == []


def test_query_endpoint_exposes_trace_id_and_review_status():
    from fastapi.testclient import TestClient

    from services.rag_engine.app import app

    client = TestClient(app)
    response = client.post(
        "/v1/query",
        headers={"X-API-Key": "meridian-test-secret-key-2026"},
        json={"query": "What storage does Meridian use?", "max_cycles": 1},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["trace_id"].startswith("trace-")
    assert data["review_status"]["flagged_chunk_ids"] == []


def test_retrieve_endpoint_passes_review_flags_to_scoring(tmp_path: Path, monkeypatch):
    import asyncio

    from fastapi.testclient import TestClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from services.rag_engine import app as app_module
    from services.rag_engine.app import app
    from services.rag_engine.deps import get_db
    from services.rag_engine.retrieval.hybrid import RetrievalResult

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/review.db")
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def seed():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with factory() as session:
            session.add_all(
                [
                    ORMDocument(id="d1", title="Doc", file_type="md"),
                    ExtractedField(
                        id="f1",
                        document_id="d1",
                        field_name="limit",
                        value="$1",
                        confidence=0.1,
                        provenance_chunk_id="chunk-flag",
                        review_status="corrected",
                    ),
                    ReviewItem(id="r1", extracted_field_id="f1", status="corrected"),
                ]
            )
            await session.commit()

    asyncio.run(seed())

    async def override_get_db():
        async with factory() as session:
            yield session

    captured: dict = {}

    def fake_retrieve(query, top_k=5, tenant_id="default", debug=False, flagged_chunk_ids=None):
        captured["flagged"] = flagged_chunk_ids
        return RetrievalResult(query=query, top_k=top_k, chunks=[], timings_ms={})

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(app_module, "_index_gate", lambda request: None)
    monkeypatch.setattr(app_module.retriever._target(), "retrieve", fake_retrieve)
    try:
        response = TestClient(app).post(
            "/v1/retrieve",
            headers={"X-API-Key": "meridian-test-secret-key-2026"},
            json={"query": "anything", "top_k": 3},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert captured["flagged"] == {"chunk-flag"}
