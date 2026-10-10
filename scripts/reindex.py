#!/usr/bin/env python3
"""Rebuild Qdrant from disk text; restart interrupted batches with --resume.

Stop ingestion while rebuilding. Without --resume this replaces the collection,
with an explicit confirmation unless --yes is supplied. No pseudo-vector fallback.
"""

import argparse
import hashlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

# Support the documented `python scripts/reindex.py` invocation.
if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, UpdateStatus, VectorParams

from packages.core.settings import Settings, get_settings
from services.ingestion.embedder import Embedder, FastEmbedEmbedder
from services.ingestion.manifest import CHUNKER_VERSION, IndexManifest, write_manifest
from services.ingestion.storage import DocumentStorageManager
from services.ingestion.vector_store import _qdrant_point_id


def reindex(
    storage: DocumentStorageManager,
    client: QdrantClient,
    settings: Settings,
    embedder: Embedder,
    *,
    resume: bool = False,
) -> IndexManifest:
    """Rebuild only the supplied client/collection, preserving IDs and metadata."""
    if embedder.model_name != settings.embedding_model or embedder.dim != settings.qdrant_vector_dim:
        raise ValueError('Embedder does not match configured model/dimension')
    chunks = storage.load_all_chunks(strict=True)
    fingerprint = hashlib.sha256(json.dumps(
        [chunk.model_dump(exclude={'embedding'}) for chunk in chunks], sort_keys=True,
    ).encode()).hexdigest()
    provenance = {
        'fingerprint': fingerprint,
        'embedding_model': embedder.model_name,
        'embedding_dim': embedder.dim,
        'chunker_version': CHUNKER_VERSION,
        'collection': settings.qdrant_collection,
    }
    checkpoint_path = storage.root_dir / 'reindex_checkpoint.json'

    def save_checkpoint(offset: int) -> None:
        temporary = checkpoint_path.with_suffix('.json.tmp')
        temporary.write_text(json.dumps({**provenance, 'offset': offset}), encoding='utf-8')
        temporary.replace(checkpoint_path)

    offset = 0
    if resume:
        checkpoint = json.loads(checkpoint_path.read_text(encoding='utf-8'))
        if any(checkpoint.get(key) != value for key, value in provenance.items()):
            raise ValueError('Reindex source/configuration changed; start a new rebuild')
        if not client.collection_exists(settings.qdrant_collection):
            raise ValueError('Cannot resume: target collection missing')
        collection = client.get_collection(settings.qdrant_collection)
        vectors_config = collection.config.params.vectors
        if not isinstance(vectors_config, VectorParams) or vectors_config.size != embedder.dim:
            raise ValueError('Cannot resume: target collection dimension changed')
        offset = checkpoint['offset']
        if client.count(settings.qdrant_collection, exact=True).count < offset:
            raise ValueError('Cannot resume: previously written points missing')
    else:
        # Invalidate readiness before replacing any vectors.
        (storage.root_dir / 'index_manifest.json').unlink(missing_ok=True)
        if client.collection_exists(settings.qdrant_collection):
            client.delete_collection(settings.qdrant_collection)
        client.create_collection(
            settings.qdrant_collection,
            vectors_config=VectorParams(size=embedder.dim, distance=Distance.COSINE),
        )
        save_checkpoint(0)

    for start in range(offset, len(chunks), 64):
        batch = chunks[start:start + 64]
        vectors = embedder.embed_passages([chunk.text for chunk in batch])
        points = []
        for chunk, vector in zip(batch, vectors, strict=True):
            payload = chunk.model_dump(exclude={'embedding'})
            payload['chunk_id'] = chunk.id
            payload['tenant_id'] = chunk.metadata.get('tenant_id', 'default')
            payload['filename'] = chunk.metadata.get('filename', chunk.metadata.get('source', ''))
            points.append(PointStruct(id=_qdrant_point_id(chunk.id), vector=vector.tolist(), payload=payload))
        result = client.upsert(settings.qdrant_collection, points=points, wait=True)
        if result.status != UpdateStatus.COMPLETED:
            raise RuntimeError(f'Qdrant did not complete upsert: {result.status}')
        save_checkpoint(start + len(batch))

    count = client.count(settings.qdrant_collection, exact=True).count
    if count != len(chunks):
        raise RuntimeError(f'Reindex count mismatch: Qdrant={count}, disk={len(chunks)}')
    storage.remove_legacy_embeddings()
    manifest = IndexManifest(embedder.model_name, embedder.dim, CHUNKER_VERSION,
                             datetime.now(UTC).isoformat(), count)
    write_manifest(storage.root_dir, manifest)
    checkpoint_path.unlink(missing_ok=True)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--storage-root', type=Path, default=None)
    parser.add_argument('--qdrant-path', help='Local Qdrant directory (default: configured server)')
    parser.add_argument('--yes', action='store_true', help='Confirm collection replacement')
    parser.add_argument('--resume', action='store_true', help='Continue an interrupted rebuild')
    args = parser.parse_args()
    settings = get_settings()
    storage = DocumentStorageManager(args.storage_root)
    if not args.resume:
        print(f'Replace collection {settings.qdrant_collection!r} using chunks from {storage.chunks_dir}')
        if not args.yes and input('Type yes to drop and rebuild this collection: ').strip().lower() != 'yes':
            print('Cancelled')
            return 1
    embedder = FastEmbedEmbedder(settings.embedding_model, settings.fastembed_cache_path,
                                expected_dim=settings.qdrant_vector_dim)
    client = (QdrantClient(path=args.qdrant_path) if args.qdrant_path
              else QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port))
    try:
        manifest = reindex(storage, client, settings, embedder, resume=args.resume)
        print(f'Reindexed {manifest.chunk_count} chunks; index manifest written')
    finally:
        client.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
