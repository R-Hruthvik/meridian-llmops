"""Startup readiness: manifest consistency gates queries; /health/ready reports real checks."""

import pytest
from fastapi.testclient import TestClient

from services.rag_engine import app as app_module
from services.rag_engine.app import app

HEADERS = {"X-API-Key": "meridian-test-secret-key-2026", "X-Tenant-Id": "readiness-tenant"}


def _write_correct_manifest() -> None:
    """The shared test storage has no manifest until a reindex; readiness needs one."""
    from packages.core.settings import get_settings
    from services.ingestion.manifest import CHUNKER_VERSION, IndexManifest, write_manifest
    from services.ingestion.storage import get_default_storage_root

    settings = get_settings()
    root = get_default_storage_root()
    disk_chunks = len(app_module.ingestion_pipeline.storage.load_all_chunks())
    write_manifest(
        root,
        IndexManifest(
            embedding_model=settings.embedding_model,
            embedding_dim=settings.qdrant_vector_dim,
            chunker_version=CHUNKER_VERSION,
            created_at="2026-01-01T00:00:00+00:00",
            chunk_count=disk_chunks,
        ),
    )


@pytest.fixture
def seeded(monkeypatch):
    from tests.fakes import FakeEmbedder

    embedder = FakeEmbedder(app_module.vector_store.dim)
    app_module.ingestion_pipeline.embedder = embedder
    app_module.retriever.embedder = embedder
    app_module.vector_store.ensure_collection()
    app_module.ingestion_pipeline.ingest_text(
        title="Readiness Fixture",
        text="Qdrant stores vectors for similarity search. BM25 indexes lexical terms.",
        source="readiness_fixture.md",
        tenant_id="readiness-tenant",
    )
    app_module.retriever.update_chunks(app_module.vector_store.get_all_chunks(None))
    _write_correct_manifest()
    yield
    _write_correct_manifest()


def test_health_ready_reports_real_checks(seeded):
    with TestClient(app) as client:
        resp = client.get("/health/ready")
        assert resp.status_code == 200
        data = resp.json()
        assert set(data["checks"]) >= {"qdrant", "embedder", "index_consistent", "llm_configured", "neo4j"}
        qdrant = data["checks"]["qdrant"]
        assert qdrant["ok"] is True and qdrant["points"] >= 1
        embedder_check = data["checks"]["embedder"]
        assert embedder_check["ok"] is True and embedder_check["dim"] > 0
        index_check = data["checks"]["index_consistent"]
        assert index_check["ok"] is True
        assert index_check["disk_chunks"] == index_check["qdrant_points"]
        assert data["ready"] is True


def test_health_live_ok(seeded):
    with TestClient(app) as client:
        resp = client.get("/health/live")
        assert resp.status_code == 200


def test_manifest_mismatch_blocks_queries(seeded):
    from services.ingestion.manifest import IndexManifest, write_manifest
    from services.ingestion.storage import get_default_storage_root

    root = get_default_storage_root()
    manifest_path = root / "index_manifest.json"
    original_bytes = manifest_path.read_bytes() if manifest_path.exists() else None
    try:
        write_manifest(
            root,
            IndexManifest(
                embedding_model="WRONG/model",
                embedding_dim=999,
                chunker_version="wrong-v0",
                created_at="2026-01-01T00:00:00+00:00",
                chunk_count=0,
            ),
        )
        with TestClient(app) as client:
            ready = client.get("/health/ready").json()
            assert ready["ready"] is False
            assert ready["checks"]["index_consistent"]["ok"] is False

            query = client.post(
                "/v1/query",
                headers=HEADERS,
                json={"query": "What is Qdrant?", "top_k": 3},
            )
            assert query.status_code == 503
            body = query.json()
            assert body["error"]["code"] == "index_inconsistent"
            assert "reindex" in body["error"]["message"].lower()

            retrieve = client.post(
                "/v1/retrieve",
                headers=HEADERS,
                json={"query": "What is Qdrant?", "top_k": 3},
            )
            assert retrieve.status_code == 503
            assert retrieve.json()["error"]["code"] == "index_inconsistent"
    finally:
        if original_bytes is None:
            manifest_path.unlink(missing_ok=True)
        else:
            manifest_path.write_bytes(original_bytes)
