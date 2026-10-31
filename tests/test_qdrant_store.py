"""Qdrant persistence, isolation, and failure contracts use the real local engine."""

import uuid
from contextlib import closing
from unittest.mock import Mock

import numpy as np
import pytest
from qdrant_client import QdrantClient, models

from packages.core.errors import IndexMismatchError, IndexReadError, IndexWriteError
from packages.core.models import Chunk
from services.ingestion.vector_store import QdrantChunkStore, point_id


@pytest.fixture
def store():
    with closing(QdrantClient(":memory:")) as client:
        store = QdrantChunkStore(client, "chunks", 3)
        store.ensure_collection()
        yield store


def chunk(identifier="legacy-doc-chunk-0", document="doc", tenant="default", filename="guide.pdf"):
    return Chunk(
        id=identifier,
        document_id=document,
        text="A payload-only answer.",
        section_heading="Setup",
        metadata={"tenant_id": tenant, "filename": filename, "page_start": 12, "custom": ["kept"]},
    )


def test_uuid5_ids_are_stable_and_upserts_idempotent(store):
    for identifier in ("legacy-doc-chunk-0", "12345678-1234-1234-1234-123456789abc"):
        assert uuid.UUID(point_id(identifier)).version == 5
    store.upsert_chunks([chunk()], [[1.0, 0.0, 0.0]])
    store.upsert_chunks([chunk()], [[1.0, 0.0, 0.0]])
    assert store.count() == 1


def test_search_materializes_complete_payload_without_local_cache(store):
    original = chunk()
    store.upsert_chunks([original], [[1.0, 0.0, 0.0]])
    reopened = QdrantChunkStore(store.client, "chunks", 3)
    hits = reopened.search([1.0, 0.0, 0.0], 5, "default")
    assert len(hits) == 1
    assert hits[0].chunk == original
    assert hits[0].score == pytest.approx(1.0)
    points, _ = store.client.scroll("chunks", with_vectors=False)
    assert "embedding" not in points[0].payload
    assert points[0].payload["chunk_id"] == original.id


def test_search_filters_and_delete_keep_other_tenants_and_documents(store):
    chunks = [
        chunk("a", "same", "one"),
        chunk("b", "same", "two"),
        chunk("c", "another", "one", "another.pdf"),
    ]
    store.upsert_chunks(chunks, [[1.0, 0.0, 0.0]] * 3)
    hits = store.search([1.0, 0.0, 0.0], 10, "one", filters={"filename": "guide.pdf"})
    assert [hit.chunk.id for hit in hits] == ["a"]
    assert store.search([1.0, 0.0, 0.0], 10, "one", filters={"tenant_id": "two"}) == []
    assert store.count(tenant_id="one") == 2
    assert store.delete_document("same", "one") == 1
    assert store.count(tenant_id="one") == 1
    assert store.count(tenant_id="two") == 1
    assert store.delete_document("same", "one") == 0
    assert store.health(tenant_id="two")["count"] == 1


@pytest.mark.parametrize(
    "params",
    [
        models.VectorParams(size=4, distance=models.Distance.COSINE),
        models.VectorParams(size=3, distance=models.Distance.DOT),
        {"named": models.VectorParams(size=3, distance=models.Distance.COSINE)},
    ],
)
def test_existing_incompatible_collection_is_preserved(params):
    with closing(QdrantClient(":memory:")) as client:
        client.create_collection("chunks", vectors_config=params)
        store = QdrantChunkStore(client, "chunks", 3)
        with pytest.raises(IndexMismatchError):
            store.ensure_collection()
        assert client.get_collection("chunks").config.params.vectors == params


def test_payload_keyword_indexes_are_requested(store, monkeypatch):
    create_index = Mock(wraps=store.client.create_payload_index)
    monkeypatch.setattr(store.client, "create_payload_index", create_index)
    store.ensure_collection()
    assert {call.kwargs["field_name"] for call in create_index.call_args_list} == {
        "document_id",
        "tenant_id",
        "filename",
    }
    assert all(
        call.kwargs["field_schema"] == models.PayloadSchemaType.KEYWORD and call.kwargs["wait"]
        for call in create_index.call_args_list
    )


def test_upsert_batches_waits_and_checks_document_counts(store, monkeypatch):
    write = Mock(wraps=store.client.upsert)
    monkeypatch.setattr(store.client, "upsert", write)
    chunks = [chunk(f"c{i}") for i in range(130)]
    assert store.upsert_chunks(chunks, np.tile([1.0, 0.0, 0.0], (130, 1))) == 130
    assert [len(call.kwargs["points"]) for call in write.call_args_list] == [64, 64, 2]
    assert all(call.kwargs["wait"] for call in write.call_args_list)
    with pytest.raises(IndexWriteError, match="count mismatch"):
        store.upsert_chunks(chunks[:1], [[1.0, 0.0, 0.0]])


@pytest.mark.parametrize("failure", ["exception", "acknowledged", "missing"])
def test_failed_or_incomplete_upsert_never_reports_success(store, monkeypatch, failure):
    def broken_write(*args, **kwargs):
        if failure == "exception":
            raise OSError("upstream unavailable")
        return models.UpdateResult(
            operation_id=1,
            status=(
                models.UpdateStatus.ACKNOWLEDGED
                if failure == "acknowledged"
                else models.UpdateStatus.COMPLETED
            ),
        )

    monkeypatch.setattr(store.client, "upsert", broken_write)
    with pytest.raises(
        IndexWriteError,
        match=("upstream unavailable" if failure == "exception" else "complete|count mismatch"),
    ):
        store.upsert_chunks([chunk()], [[1.0, 0.0, 0.0]])


def test_search_failure_is_visible_and_health_reports_the_error(store, monkeypatch):
    def unavailable(*args, **kwargs):
        raise OSError("Qdrant disconnected")

    monkeypatch.setattr(store.client, "query_points", unavailable)
    with pytest.raises(IndexReadError, match="Qdrant disconnected"):
        store.search([1.0, 0.0, 0.0], 5, "default")
    monkeypatch.setattr(store.client, "get_collection", unavailable)
    report = store.health()
    assert report["status"] == "unavailable"
    assert report["count"] is None
    assert "Qdrant disconnected" in report["error"]


def test_delete_failure_is_visible(store, monkeypatch):
    store.upsert_chunks([chunk()], [[1.0, 0.0, 0.0]])

    def unavailable(*args, **kwargs):
        raise OSError("delete unavailable")

    monkeypatch.setattr(store.client, "delete", unavailable)
    with pytest.raises(IndexWriteError, match="delete unavailable"):
        store.delete_document("doc", "default")
    assert store.count() == 1


@pytest.mark.parametrize("vectors", [[], [[1.0, 0.0]], [[float("nan"), 0.0, 0.0]]])
def test_bad_vectors_raise_before_writing(store, vectors):
    with pytest.raises(IndexWriteError):
        store.upsert_chunks([chunk()], vectors)
    assert store.count() == 0


def test_payload_scroll_crosses_pages_and_clear_preserves_other_tenants(store):
    chunks = [chunk(f"c{i}", tenant="one") for i in range(260)] + [chunk("other", tenant="two")]
    store.upsert_chunks(chunks, [[1.0, 0.0, 0.0]] * len(chunks))
    assert {c.id for c in store.get_all_chunks("one")} == {f"c{i}" for i in range(260)}
    store.clear("one")
    assert store.get_all_chunks("one") == []
    assert [c.id for c in store.get_all_chunks("two")] == ["other"]
