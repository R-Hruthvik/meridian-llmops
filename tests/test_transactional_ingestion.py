"""Transactional ingestion: rollback, duplicates, updates, delete residue (F-10)."""

import json
from pathlib import Path

import pytest

from packages.core.errors import IndexWriteError, IngestionError
from services.ingestion.pipeline import IngestionPipeline
from tests.fakes import FakeEmbedder, make_vector_store

DOC_TEXT = (
    "# Employee Handbook\n\n"
    "Sick leave: every employee receives 10 days of paid sick leave per calendar year. "
    "Vacation leave accrues at 1.5 days per month of service. "
    "Parental leave is 12 weeks for the primary caregiver."
)


def build_pipeline(tmp_path, embedder=None):
    embedder = embedder or FakeEmbedder()
    store = make_vector_store(embedder)
    pipeline = IngestionPipeline(vector_store=store, embedder=embedder, storage_root=tmp_path / "storage")
    return pipeline, store


def use_legacy_original_layout(pipeline, document_id, legacy_filename=None):
    meta_path = pipeline.storage.meta_dir / f"{document_id}.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    original_path = meta.pop("original_path")
    original_bytes = Path(original_path).read_bytes()
    legacy_filename = legacy_filename or f"{document_id}_handbook.md"
    (pipeline.storage.docs_dir / legacy_filename).write_bytes(original_bytes)
    Path(original_path).unlink()
    meta["filename"] = legacy_filename
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    return pipeline.storage.docs_dir / legacy_filename


def test_success_counts_match_across_stores(tmp_path):
    pipeline, store = build_pipeline(tmp_path)
    result = pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"), tenant_id="default")
    assert result.status == "indexed"
    assert result.chunks >= 1

    disk_chunks = len(pipeline.storage.load_all_chunks())
    qdrant_count = store.count(tenant_id="default")
    assert disk_chunks == qdrant_count == result.chunks
    manifest = (tmp_path / "storage" / "index_manifest.json")
    assert manifest.exists()


def test_qdrant_failure_leaves_no_partial_state(tmp_path, monkeypatch):
    pipeline, store = build_pipeline(tmp_path)

    def boom(*args, **kwargs):
        raise IndexWriteError("simulated Qdrant failure")

    monkeypatch.setattr(store, "upsert_chunks", boom)
    with pytest.raises(IngestionError):
        pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))

    assert pipeline.storage.list_documents() == []
    assert (tmp_path / "storage" / "chunks").glob("*.json") == [] or not list(
        (tmp_path / "storage" / "chunks").glob("*.json")
    )
    assert store.count(tenant_id="default") == 0


def test_manifest_failure_rolls_back_new_document(tmp_path, monkeypatch):
    pipeline, store = build_pipeline(tmp_path)

    def fail_manifest():
        raise OSError("simulated manifest failure")

    monkeypatch.setattr(pipeline, "_publish_manifest", fail_manifest)
    with pytest.raises(IngestionError):
        pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))

    assert pipeline.storage.list_documents() == []
    assert pipeline.storage.load_all_chunks() == []
    assert not list((tmp_path / "storage" / "originals").rglob("*"))
    assert store.count(tenant_id="default") == 0


def test_graph_failure_rolls_back_partial_graph_state(tmp_path, monkeypatch):
    pipeline, store = build_pipeline(tmp_path)
    original_extract = pipeline.graph_store.extract_and_store

    def fail_after_graph_write(doc_id, text):
        original_extract(doc_id, text)
        raise RuntimeError("simulated graph failure")

    monkeypatch.setattr(pipeline.graph_store, "extract_and_store", fail_after_graph_write)
    with pytest.raises(IngestionError):
        pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))

    assert pipeline.graph_store.entities == {}
    assert pipeline.graph_store.relationships == []
    assert pipeline.storage.list_documents() == []
    assert store.count(tenant_id="default") == 0


def test_partial_storage_failure_removes_original_without_metadata(tmp_path, monkeypatch):
    pipeline, store = build_pipeline(tmp_path)
    def fail_after_original_write(*args, **kwargs):
        doc = kwargs["doc"]
        original_name = doc.source
        original_path = pipeline.storage.originals_dir / "default" / doc.id / original_name
        from services.ingestion.storage import atomic_write_bytes

        atomic_write_bytes(original_path, DOC_TEXT.encode("utf-8"))
        raise OSError("simulated chunk record failure")

    monkeypatch.setattr(pipeline.storage, "save_document", fail_after_original_write)
    with pytest.raises(IngestionError):
        pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))

    assert pipeline.storage.list_documents() == []
    assert pipeline.storage.load_all_chunks() == []
    assert not list((tmp_path / "storage" / "originals").rglob("*"))
    assert store.count(tenant_id="default") == 0


def test_failed_old_qdrant_delete_keeps_old_document_on_update(tmp_path, monkeypatch):
    pipeline, store = build_pipeline(tmp_path)
    first = pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))
    def fail_old_delete(document_id, tenant_id):
        if document_id == first.document_id:
            raise IndexWriteError("simulated old-document delete failure")
        return store_delete(document_id, tenant_id)

    store_delete = store.delete_document

    monkeypatch.setattr(store, "delete_document", fail_old_delete)
    with pytest.raises(IngestionError):
        pipeline.ingest_file("handbook.md", (DOC_TEXT + " New policy.").encode("utf-8"))

    assert [doc["id"] for doc in pipeline.storage.list_documents()] == [first.document_id]
    assert {chunk.document_id for chunk in pipeline.storage.load_all_chunks()} == {first.document_id}
    assert store.count(tenant_id="default") == first.chunks


def test_failed_old_disk_delete_restores_old_vectors_on_update(tmp_path, monkeypatch):
    pipeline, store = build_pipeline(tmp_path)
    first = pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))
    original_delete = pipeline.storage.delete_document

    def fail_old_disk_delete(doc_id):
        if doc_id == first.document_id:
            raise OSError("simulated disk delete failure")
        return original_delete(doc_id)

    monkeypatch.setattr(pipeline.storage, "delete_document", fail_old_disk_delete)
    with pytest.raises(IngestionError):
        pipeline.ingest_file("handbook.md", (DOC_TEXT + " New policy.").encode("utf-8"))

    assert [doc["id"] for doc in pipeline.storage.list_documents()] == [first.document_id]
    assert {chunk.document_id for chunk in pipeline.storage.load_all_chunks()} == {first.document_id}
    assert store.count(tenant_id="default") == first.chunks


def test_failed_old_graph_delete_restores_all_old_state_on_update(tmp_path, monkeypatch):
    pipeline, store = build_pipeline(tmp_path)
    first = pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))
    old_chunk_ids = pipeline.graph_store._tenant_doc_chunks[("default", first.document_id)].copy()
    old_entities = pipeline.graph_store._doc_entities[first.document_id].copy()
    old_relationships = list(pipeline.graph_store._doc_relationships[first.document_id])
    original_delete = pipeline.graph_store.delete_by_document

    def fail_after_graph_delete(doc_id, tenant_id="default"):
        result = original_delete(doc_id, tenant_id=tenant_id)
        if doc_id == first.document_id:
            raise RuntimeError("simulated graph delete failure")
        return result

    monkeypatch.setattr(pipeline.graph_store, "delete_by_document", fail_after_graph_delete)
    with pytest.raises(IngestionError):
        pipeline.ingest_file("handbook.md", (DOC_TEXT + " New policy.").encode("utf-8"))

    assert [doc["id"] for doc in pipeline.storage.list_documents()] == [first.document_id]
    assert store.count(tenant_id="default") == first.chunks
    assert pipeline.graph_store._doc_entities[first.document_id] == old_entities
    assert pipeline.graph_store._doc_relationships[first.document_id] == old_relationships
    assert pipeline.graph_store._tenant_doc_chunks[("default", first.document_id)] == old_chunk_ids

    monkeypatch.setattr(pipeline.graph_store, "delete_by_document", original_delete)
    assert pipeline.delete_document(first.document_id) is True
    assert ("default", first.document_id) not in pipeline.graph_store._tenant_doc_chunks
    assert not old_chunk_ids & {
        chunk_id
        for entity in pipeline.graph_store.get_entities()
        for chunk_id in entity.chunk_ids
    }


def test_manifest_failure_during_update_preserves_old_document(tmp_path, monkeypatch):
    pipeline, store = build_pipeline(tmp_path)
    first = pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))

    def fail_manifest(*_args, **_kwargs):
        raise OSError("simulated manifest failure")

    monkeypatch.setattr(pipeline, "_publish_manifest", fail_manifest)
    with pytest.raises(IngestionError):
        pipeline.ingest_file("handbook.md", (DOC_TEXT + " New policy.").encode("utf-8"))

    assert [doc["id"] for doc in pipeline.storage.list_documents()] == [first.document_id]
    assert {chunk.document_id for chunk in pipeline.storage.load_all_chunks()} == {first.document_id}
    assert store.count(tenant_id="default") == first.chunks


def test_delete_qdrant_failure_preserves_disk_and_graph(tmp_path, monkeypatch):
    pipeline, store = build_pipeline(tmp_path)
    result = pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))
    def fail_delete(document_id, tenant_id):
        raise IndexWriteError("simulated Qdrant delete failure")

    monkeypatch.setattr(store, "delete_document", fail_delete)
    with pytest.raises(IngestionError):
        pipeline.delete_document(result.document_id)

    assert [doc["id"] for doc in pipeline.storage.list_documents()] == [result.document_id]
    assert store.count(tenant_id="default") == result.chunks
    assert pipeline.graph_store._doc_entities.get(result.document_id)


def test_manifest_failure_before_delete_preserves_document(tmp_path, monkeypatch):
    pipeline, store = build_pipeline(tmp_path)
    result = pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))

    def fail_manifest(*_args, **_kwargs):
        raise OSError("simulated manifest failure")

    monkeypatch.setattr(pipeline, "_publish_manifest", fail_manifest)
    with pytest.raises(IngestionError):
        pipeline.delete_document(result.document_id)

    assert [doc["id"] for doc in pipeline.storage.list_documents()] == [result.document_id]
    assert store.count(tenant_id="default") == result.chunks


def test_duplicate_upload_returns_duplicate_of(tmp_path):
    pipeline, store = build_pipeline(tmp_path)
    first = pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))
    second = pipeline.ingest_file("renamed-copy.md", DOC_TEXT.encode("utf-8"))
    assert first.status == "indexed"
    assert second.status == "duplicate"
    assert second.duplicate_of == first.document_id
    assert store.count(tenant_id="default") == first.chunks


def test_same_filename_new_content_replaces_old(tmp_path):
    pipeline, store = build_pipeline(tmp_path)
    first = pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))
    updated = pipeline.ingest_file(
        "handbook.md", (DOC_TEXT + "\n\n bereavement: 5 days").encode("utf-8")
    )
    assert updated.status == "indexed"
    assert updated.document_id != first.document_id
    # The old document's chunks must not survive the update.
    disk_ids = {c.document_id for c in pipeline.storage.load_all_chunks()}
    assert disk_ids == {updated.document_id}
    assert store.count(tenant_id="default") == updated.chunks


def test_delete_leaves_no_residue(tmp_path):
    pipeline, store = build_pipeline(tmp_path)
    result = pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))
    doc_id = result.document_id
    assert pipeline.delete_document(doc_id) is True
    assert pipeline.storage.list_documents() == []
    assert pipeline.storage.load_all_chunks() == []
    assert store.count(tenant_id="default") == 0
    assert not list((tmp_path / "storage" / "originals").rglob("*.md"))


@pytest.mark.parametrize("legacy_filename", ["employee handbook.md", "employee_handbook.md"])
def test_delete_removes_legacy_original_file(tmp_path, legacy_filename):
    pipeline, _store = build_pipeline(tmp_path)
    result = pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))
    legacy_path = use_legacy_original_layout(pipeline, result.document_id, legacy_filename)

    assert pipeline.delete_document(result.document_id) is True

    assert not legacy_path.exists()


def test_failed_legacy_delete_restores_original_and_vectors_on_update(tmp_path, monkeypatch):
    pipeline, store = build_pipeline(tmp_path)
    first = pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))
    legacy_path = use_legacy_original_layout(
        pipeline, first.document_id, "employee handbook.md"
    )
    old_bytes = legacy_path.read_bytes()
    original_delete = pipeline.storage.delete_document

    def fail_after_old_disk_delete(doc_id):
        deleted = original_delete(doc_id)
        if doc_id == first.document_id:
            raise OSError("simulated legacy disk delete failure")
        return deleted

    monkeypatch.setattr(pipeline.storage, "delete_document", fail_after_old_disk_delete)
    with pytest.raises(IngestionError):
        pipeline.ingest_file("handbook.md", (DOC_TEXT + " New policy.").encode("utf-8"))

    assert legacy_path.read_bytes() == old_bytes
    assert [doc["id"] for doc in pipeline.storage.list_documents()] == [first.document_id]
    assert store.count(tenant_id="default") == first.chunks


def test_ingest_text_persists_and_indexes(tmp_path):
    pipeline, store = build_pipeline(tmp_path)
    result = pipeline.ingest_text(text=DOC_TEXT, title="Handbook", source="handbook.md")
    assert result.status == "indexed"
    assert len(pipeline.storage.load_all_chunks()) == result.chunks
    assert store.count(tenant_id="default") == result.chunks


def test_reindex_all_rebuilds_the_active_vector_store(tmp_path, monkeypatch):
    from packages.core.settings import Settings

    pipeline, store = build_pipeline(tmp_path)
    settings = Settings(
        _env_file=None,
        embedding_model=pipeline.embedder.model_name,
        qdrant_vector_dim=pipeline.embedder.dim,
        qdrant_collection=store.collection_name,
    )
    monkeypatch.setattr("packages.core.settings.get_settings", lambda: settings)
    result = pipeline.ingest_file("handbook.md", DOC_TEXT.encode("utf-8"))
    query_vector = pipeline.embedder.embed_query("Employee Handbook")
    before = store.search(query_vector, k=1, tenant_id="default")[0]

    rebuilt = pipeline.reindex_all()
    after = store.search(query_vector, k=1, tenant_id="default")[0]

    assert rebuilt.chunk_count == result.chunks
    assert store.count(tenant_id="default") == result.chunks
    assert after.chunk.id == before.chunk.id
    assert after.score == pytest.approx(before.score)


def test_rejects_oversized_and_unsupported(tmp_path):
    pipeline, _store = build_pipeline(tmp_path)
    with pytest.raises(IngestionError):
        pipeline.ingest_file("big.txt", b"x" * (pipeline.max_upload_bytes + 1))
    with pytest.raises(IngestionError):
        pipeline.ingest_file("evil.exe", b"MZ" + b"x" * 100)


def test_scanned_pdf_style_document_warns_without_indexing_garbage(tmp_path):
    pipeline, store = build_pipeline(tmp_path)
    # A real PDF with image-only (text-free) pages, like a scan.
    import io

    from pypdf import PdfWriter

    writer = PdfWriter()
    for _ in range(6):
        writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)

    result = pipeline.ingest_file("scan.pdf", buffer.getvalue())
    assert result.status == "indexed_with_warnings"
    assert any("scanned" in warning for warning in result.warnings)
    assert result.chunks == 0
    assert store.count(tenant_id="default") == 0
    # The document is still catalogued so the operator can see the warning.
    docs = pipeline.storage.list_documents()
    assert len(docs) == 1 and docs[0]["chunk_count"] == 0

def test_ingest_text_replaces_the_document_with_the_same_source(tmp_path):
    pipeline, store = build_pipeline(tmp_path)
    first = pipeline.ingest_text(text=DOC_TEXT, title="Handbook", source="handbook.md")
    second = pipeline.ingest_text(
        text=DOC_TEXT + " New policy.", title="Handbook", source="handbook.md"
    )

    documents = pipeline.storage.list_documents()
    assert [doc["id"] for doc in documents] == [second.document_id]
    assert first.document_id != second.document_id
    assert store.count(tenant_id="default") == second.chunks
    assert pipeline.storage.find_by_filename("handbook.md", "default") == second.document_id


def test_ingest_text_manual_documents_replace_by_title_and_format(tmp_path):
    pipeline, store = build_pipeline(tmp_path)
    first = pipeline.ingest_text(text="Draft one.", title="Notes")
    second = pipeline.ingest_text(text="Draft two.", title="Notes")

    assert [doc["id"] for doc in pipeline.storage.list_documents()] == [second.document_id]
    assert first.filename == second.filename == "Notes.md"
    assert store.count(tenant_id="default") == second.chunks
