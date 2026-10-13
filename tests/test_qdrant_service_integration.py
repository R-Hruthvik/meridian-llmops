"""Small round-trip against the Qdrant service configured by CI."""

import os
import uuid
from contextlib import closing

import pytest
from qdrant_client import QdrantClient

from packages.core.models import Chunk
from services.ingestion.vector_store import QdrantChunkStore

QDRANT_URL = os.environ.get("QDRANT_URL")
pytestmark = pytest.mark.skipif(not QDRANT_URL, reason="QDRANT_URL is only set for service integration runs")


def test_qdrant_service_stores_and_searches_chunk_payloads():
    collection = f"ci_{uuid.uuid4().hex}"
    with closing(QdrantClient(url=QDRANT_URL)) as client:
        try:
            store = QdrantChunkStore(client, collection, dim=3)
            store.ensure_collection()
            chunk = Chunk(
                id="ci-qdrant-roundtrip",
                document_id="ci-document",
                text="Service-backed Qdrant round trip.",
                section_heading="CI",
                metadata={"tenant_id": "ci", "filename": "ci.md"},
            )

            assert store.upsert_chunks([chunk], [[1.0, 0.0, 0.0]]) == 1
            hits = store.search([1.0, 0.0, 0.0], k=1, tenant_id="ci")

            assert len(hits) == 1
            assert hits[0].chunk == chunk
            assert hits[0].score == pytest.approx(1.0)
        finally:
            if client.collection_exists(collection):
                client.delete_collection(collection)
