"""Multipart ingestion contracts with real parsers and an isolated local index."""

import io

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from services.ingestion.pipeline import IngestionPipeline
from services.rag_engine import app as app_module
from services.rag_engine.retrieval.hybrid import HybridRetriever
from tests.fakes import FakeEmbedder, make_vector_store

HEADERS = {"X-API-Key": "meridian-test-secret-key-2026"}


def test_upload_limit_is_configurable(monkeypatch):
    from packages.core.settings import Settings

    monkeypatch.setenv("MAX_UPLOAD_MB", "2")
    assert Settings().max_upload_mb == 2


def pdf_bytes(text=None):
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=300)
    if text:
        font = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
        )
        stream = DecodedStreamObject()
        stream.set_data(f"BT /F1 12 Tf 20 200 Td ({text}) Tj ET".encode())
        page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.fixture
def upload_client(tmp_path, monkeypatch):
    embedder = FakeEmbedder()
    store = make_vector_store(embedder)
    pipeline = IngestionPipeline(store, embedder=embedder, storage_root=tmp_path)
    monkeypatch.setattr(app_module, "vector_store", store)
    monkeypatch.setattr(app_module, "ingestion_pipeline", pipeline)
    monkeypatch.setattr(app_module, "retriever", HybridRetriever(embedder, store))
    yield TestClient(app_module.app), pipeline
    store.client.close()


def test_upload_mixed_formats_and_fetch_source_metadata(upload_client):
    client, _ = upload_client
    response = client.post(
        "/v1/documents",
        headers=HEADERS,
        files=[
            (
                "files",
                ("policy.pdf", pdf_bytes("Employees receive twenty days of vacation every year.")),
            ),
            (
                "files",
                (
                    "policy.md",
                    b"# Leave Policy\n\n## Sick Leave\n\nEmployees receive ten days of sick leave.",
                ),
            ),
            ("files", ("policy.txt", b"The office opens at nine every weekday morning.")),
        ],
    )
    assert response.status_code == 200
    rows = response.json()["results"]
    assert [row["status"] for row in rows] == ["indexed"] * 3
    assert [row["format"] for row in rows] == ["pdf", "md", "txt"]
    for row in rows:
        detail = client.get(f"/v1/documents/{row['document_id']}/chunks", headers=HEADERS)
        assert detail.status_code == 200
        chunks = detail.json()["chunks"]
        assert chunks and chunks[0]["text"]
        if row["format"] == "pdf":
            assert chunks[0]["metadata"]["page_start"] == 1
            assert "twenty days" in chunks[0]["text"]
        if row["format"] == "md":
            assert chunks[0]["metadata"]["heading_path"] == "Leave Policy > Sick Leave"


def test_rejection_does_not_prevent_other_files_and_scan_warning_is_visible(upload_client):
    client, pipeline = upload_client
    pipeline.max_upload_bytes = 2048
    response = client.post(
        "/v1/documents",
        headers=HEADERS,
        files=[
            ("files", ("bad.exe", b"MZ")),
            ("files", ("too-big.txt", b"x" * 2049)),
            ("files", ("scan.pdf", pdf_bytes())),
            ("files", ("good.txt", b"A valid document with useful information.")),
        ],
    )
    assert response.status_code == 200
    rows = response.json()["results"]
    assert [row["status"] for row in rows] == [
        "rejected",
        "rejected",
        "indexed_with_warnings",
        "indexed",
    ]
    assert rows[0]["error"] and rows[1]["error"]
    assert rows[2]["chunks"] == 0
    assert any("scanned" in warning.lower() for warning in rows[2]["warnings"])
    assert len(pipeline.storage.list_documents()) == 2


def test_json_ingest_preserves_existing_ui_response_fields(upload_client):
    client, pipeline = upload_client
    response = client.post(
        "/v1/ingest",
        headers=HEADERS,
        json={
            "title": "Office Hours",
            "text": "The office opens at nine.",
            "source": "hours.txt",
            "format": "txt",
        },
    )
    assert response.status_code == 200
    row = response.json()
    assert row["title"] == "Office Hours"
    assert row["chunks_indexed"] == row["chunks"] >= 1
    assert pipeline.get_document(row["document_id"])["title"] == "Office Hours"


def test_delete_document_evicts_chunks_from_vector_and_lexical_indexes(upload_client):
    client, _ = upload_client
    created = client.post(
        "/v1/ingest",
        headers=HEADERS,
        json={
            "title": "Eviction Probe",
            "text": "Meridian zzzquux lexical eviction probe token.",
            "source": "eviction_probe.txt",
            "format": "txt",
        },
    ).json()
    doc_id = created["document_id"]
    assert any(chunk.document_id == doc_id for chunk in app_module.retriever.bm25_index.chunks)

    deleted = client.delete(f"/v1/documents/{doc_id}", headers=HEADERS)
    assert deleted.status_code == 200

    assert all(chunk.document_id != doc_id for chunk in app_module.retriever.bm25_index.chunks)
    assert app_module.vector_store.count() == 0
    resp = client.post(
        "/v1/retrieve", headers=HEADERS, json={"query": "zzzquux eviction probe", "top_k": 5}
    )
    assert resp.status_code == 200
    assert resp.json()["chunks"] == []


@pytest.mark.asyncio
async def test_oversized_upload_stops_reading_at_limit(upload_client):
    _, pipeline = upload_client
    pipeline.max_upload_bytes = 16

    class OversizedUpload:
        filename = "large.txt"
        consumed = 0

        async def read(self, size=-1):
            if size < 0:
                self.consumed = 100_000
                return b"x" * self.consumed
            data = b"x" * min(size, 100_000 - self.consumed)
            self.consumed += len(data)
            return data

    upload = OversizedUpload()
    result = await app_module.upload_documents_endpoint([upload], "default")
    assert result["results"][0]["status"] == "rejected"
    assert upload.consumed <= 17
    assert pipeline.storage.list_documents() == []


def test_upload_unexpected_error_returns_generic_message(upload_client, monkeypatch):
    client, pipeline = upload_client

    def boom(*args, **kwargs):
        raise RuntimeError("secret internal details")

    monkeypatch.setattr(pipeline, "ingest_file", boom)
    response = client.post(
        "/v1/documents",
        headers=HEADERS,
        files=[("files", ("x.txt", b"hello"))],
    )
    assert response.status_code == 200
    row = response.json()["results"][0]
    assert row["status"] == "rejected"
    assert row["error"] == "Internal error while processing upload."
    assert "secret internal details" not in response.text
