"""Tests for the live Index & Storage inspector behind GET /v1/index/status.

The endpoint's contract is honesty: every number is read from a real query, and a
dead backend is reported as degraded rather than raising or faking data.
"""

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from packages.core.models import Base, ORMDocument
from services.rag_engine.index_inspector import build_index_status

HEADERS = {"X-API-Key": "meridian-test-secret-key-2026"}


class _DeadStore:
    """Stands in for a store whose every attribute access hits a dead backend."""

    def __getattr__(self, name: str):
        raise RuntimeError("connection refused")


@pytest.fixture
def client():
    from services.rag_engine.app import app

    return TestClient(app)


@pytest_asyncio.fixture
async def db_session():
    """Isolated relational store; callers seed the rows they want counted."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)()
    yield session
    await session.close()
    await engine.dispose()


def test_index_status_reports_every_section_when_backends_are_down(client):
    """The shape survives a fully degraded stack - that is the point of the endpoint."""
    response = client.get("/v1/index/status", headers=HEADERS)
    assert response.status_code == 200
    body = response.json()

    assert set(body) == {"vector", "graph", "lexical", "relational", "backends"}
    for section in ("vector", "graph", "lexical", "relational"):
        assert isinstance(body[section], dict), f"{section} section missing"

    for name, backend in body["backends"].items():
        assert set(backend) == {"reachable", "is_fallback", "endpoint", "detail"}, name
        assert isinstance(backend["reachable"], bool)
        assert isinstance(backend["is_fallback"], bool)
        assert backend["detail"]


def test_index_status_requires_api_key(client):
    assert client.get("/v1/index/status").status_code == 401


@pytest.mark.asyncio
async def test_relational_row_counts_reflect_rows_written_by_the_test(db_session):
    """Row counts must come from SELECT COUNT(*), not a constant."""
    from services.rag_engine.app import graph_store, retriever, vector_store

    db_session.add_all(
        ORMDocument(id=f"doc_{i}", title=f"Doc {i}", file_type="txt") for i in range(3)
    )
    await db_session.commit()

    status = await build_index_status(
        vector_store=vector_store, graph_store=graph_store, retriever=retriever, db=db_session
    )

    counts = {table.name: table.row_count for table in status.relational.tables}
    assert counts["documents"] == 3
    assert counts["review_items"] == 0
    assert counts["chunks"] == 0
    assert status.relational.total_rows == sum(counts.values())


@pytest.mark.asyncio
async def test_vector_section_is_fallback_when_backend_unreachable(db_session):
    """A dead Qdrant is labelled a fallback instead of reporting invented collections."""
    status = await build_index_status(
        vector_store=_DeadStore(), graph_store=_DeadStore(), retriever=_DeadStore(), db=db_session
    )

    assert status.vector.is_fallback is True
    assert status.vector.collections == []
    assert status.vector.points_per_collection == {}
    assert status.backends["vector"].reachable is False
    assert status.backends["vector"].is_fallback is True
    assert status.backends["vector"].detail


@pytest.mark.asyncio
async def test_graph_section_is_fallback_when_backend_unreachable(db_session):
    from services.rag_engine.app import retriever, vector_store

    status = await build_index_status(
        vector_store=vector_store, graph_store=_DeadStore(), retriever=retriever, db=db_session
    )

    assert status.graph.is_fallback is True
    assert status.graph.node_count is None
    assert status.backends["graph"].reachable is False


@pytest.mark.asyncio
async def test_build_index_status_never_raises_on_a_dead_backend():
    """Every subsystem is dead AND the relational session is broken: still no raise."""

    class _DeadSession:
        async def connection(self):
            raise RuntimeError("database is locked")

    status = await build_index_status(
        vector_store=_DeadStore(), graph_store=_DeadStore(), retriever=_DeadStore(), db=_DeadSession()
    )

    assert status.backends["relational"].reachable is False
    assert status.backends["relational"].detail
    assert status.relational.tables == []


@pytest.mark.asyncio
async def test_lexical_corpus_size_is_read_from_the_live_retriever(db_session):
    """BM25 corpus size tracks real indexed chunks rather than a hardcoded figure."""
    from services.rag_engine.app import graph_store, ingestion_pipeline, retriever, vector_store

    before = await build_index_status(
        vector_store=vector_store, graph_store=graph_store, retriever=retriever, db=db_session
    )
    assert before.lexical.corpus_size == len(retriever.bm25_index.chunks)

    ingestion_pipeline.ingest_text(
        title="Inspector Probe Document",
        text="Meridian inspects the BM25 sparse index with a real retrieval probe.",
        source="index_inspector_probe.md",
    )
    retriever.update_chunks(vector_store.get_all_chunks())

    after = await build_index_status(
        vector_store=vector_store, graph_store=graph_store, retriever=retriever, db=db_session
    )
    assert after.lexical.corpus_size == len(retriever.bm25_index.chunks)
    assert after.lexical.corpus_size > before.lexical.corpus_size
    assert after.lexical.document_count >= 1
