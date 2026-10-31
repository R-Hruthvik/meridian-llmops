#!/usr/bin/env python3
"""Rebuild Qdrant from disk text; restart interrupted batches with --resume.

Stop ingestion while rebuilding. Without --resume this replaces the collection,
with an explicit confirmation unless --yes is supplied. No pseudo-vector fallback.
"""

import argparse
import hashlib
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

# Support the documented `python scripts/reindex.py` invocation.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams

from packages.core.settings import Settings, get_settings
from services.ingestion.chunker import embedded_text
from services.ingestion.embedder import Embedder, FastEmbedEmbedder
from services.ingestion.manifest import CHUNKER_VERSION, IndexManifest, write_manifest
from services.ingestion.storage import DocumentStorageManager, get_default_storage_root
from services.ingestion.vector_store import QdrantChunkStore, point_id


def reindex(
    storage: DocumentStorageManager,
    client: QdrantClient,
    settings: Settings,
    embedder: Embedder,
    *,
    resume: bool = False,
) -> IndexManifest:
    """Rebuild only the supplied client/collection, preserving IDs and metadata."""
    if (
        embedder.model_name != settings.embedding_model
        or embedder.dim != settings.qdrant_vector_dim
    ):
        raise ValueError("Embedder does not match configured model/dimension")
    chunks = storage.load_all_chunks(strict=True)
    fingerprint = hashlib.sha256(
        json.dumps(
            [chunk.model_dump(exclude={"embedding"}) for chunk in chunks],
            sort_keys=True,
        ).encode()
    ).hexdigest()
    provenance = {
        "fingerprint": fingerprint,
        "embedding_model": embedder.model_name,
        "embedding_dim": embedder.dim,
        "chunker_version": CHUNKER_VERSION,
        "collection": settings.qdrant_collection,
    }
    checkpoint_path = storage.root_dir / "reindex_checkpoint.json"

    def save_checkpoint(offset: int) -> None:
        temporary = checkpoint_path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps({**provenance, "offset": offset}), encoding="utf-8")
        temporary.replace(checkpoint_path)

    offset = 0
    store = QdrantChunkStore(client, settings.qdrant_collection, embedder.dim)
    if resume:
        checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
        if any(checkpoint.get(key) != value for key, value in provenance.items()):
            raise ValueError("Reindex source/configuration changed; start a new rebuild")
        if not client.collection_exists(settings.qdrant_collection):
            raise ValueError("Cannot resume: target collection missing")
        collection = client.get_collection(settings.qdrant_collection)
        vectors_config = collection.config.params.vectors
        if not isinstance(vectors_config, VectorParams) or vectors_config.size != embedder.dim:
            raise ValueError("Cannot resume: target collection dimension changed")
        offset = checkpoint.get("offset")
        if (
            type(offset) is not int
            or not 0 <= offset <= len(chunks)
            or (offset != len(chunks) and offset % 64 != 0)
        ):
            raise ValueError("Cannot resume: invalid checkpoint offset")
        # A total count can hide replaced points. Verify every committed ID.
        for start in range(0, offset, 64):
            expected_ids = {point_id(chunk.id) for chunk in chunks[start : min(start + 64, offset)]}
            records = client.retrieve(
                settings.qdrant_collection,
                ids=list(expected_ids),
                with_payload=False,
                with_vectors=False,
            )
            if {str(record.id) for record in records} != expected_ids:
                raise ValueError("Cannot resume: previously written points missing")
    else:
        # Invalidate readiness before replacing any vectors.
        (storage.root_dir / "index_manifest.json").unlink(missing_ok=True)
        if client.collection_exists(settings.qdrant_collection):
            client.delete_collection(settings.qdrant_collection)
        save_checkpoint(0)

    store.ensure_collection()
    counts = Counter(
        (str(c.metadata.get("tenant_id", "default")), c.document_id) for c in chunks[:offset]
    )
    for start in range(offset, len(chunks), 64):
        batch = chunks[start : start + 64]
        vectors = embedder.embed_passages([embedded_text(chunk) for chunk in batch])
        counts.update((str(c.metadata.get("tenant_id", "default")), c.document_id) for c in batch)
        store.upsert_chunks(batch, vectors, document_counts=counts)
        save_checkpoint(start + len(batch))

    count = store.count()
    if count != len(chunks):
        raise RuntimeError(f"Reindex count mismatch: Qdrant={count}, disk={len(chunks)}")
    storage.remove_legacy_embeddings()
    manifest = IndexManifest(
        embedder.model_name, embedder.dim, CHUNKER_VERSION, datetime.now(UTC).isoformat(), count
    )
    write_manifest(storage.root_dir, manifest)
    checkpoint_path.unlink(missing_ok=True)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--storage-root", type=Path, default=None)
    parser.add_argument(
        "--qdrant-path", help="Override the configured backend with a local Qdrant directory"
    )
    parser.add_argument("--yes", action="store_true", help="Confirm collection replacement")
    parser.add_argument("--resume", action="store_true", help="Continue an interrupted rebuild")
    args = parser.parse_args()
    if args.qdrant_path and (
        args.storage_root is None
        or args.storage_root.resolve() == get_default_storage_root().resolve()
    ):
        parser.error("--qdrant-path requires an isolated --storage-root outside default storage")
    settings = get_settings()
    storage = DocumentStorageManager(args.storage_root)
    if not args.resume:
        print(
            f"Replace collection {settings.qdrant_collection!r} using chunks from {storage.chunks_dir}"
        )
        if (
            not args.yes
            and input("Type yes to drop and rebuild this collection: ").strip().lower() != "yes"
        ):
            print("Cancelled")
            return 1
    embedder = FastEmbedEmbedder(
        settings.embedding_model,
        settings.fastembed_cache_path,
        expected_dim=settings.qdrant_vector_dim,
    )
    local_path = args.qdrant_path
    if local_path is None and settings.vector_backend == "qdrant_local":
        local_path = settings.qdrant_local_path
    if local_path == ":memory:":
        client = QdrantClient(":memory:")
    elif local_path is not None:
        client = QdrantClient(path=local_path)
    else:
        client = QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)
    try:
        manifest = reindex(storage, client, settings, embedder, resume=args.resume)
        print(f"Reindexed {manifest.chunk_count} chunks; index manifest written")
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
