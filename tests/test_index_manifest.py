"""Index provenance and safe rebuild regression checks use temporary disk/Qdrant."""

import json
from contextlib import closing
from dataclasses import replace

import pytest
from qdrant_client import QdrantClient

from packages.core.models import Chunk, Document
from packages.core.settings import Settings
from scripts.reindex import reindex
from services.ingestion.manifest import (
    CHUNKER_VERSION,
    IndexManifest,
    check_consistency,
    read_manifest,
    write_manifest,
)
from services.ingestion.storage import DocumentStorageManager
from tests.fakes import FakeEmbedder


def settings():
    return Settings(_env_file=None, embedding_model=FakeEmbedder.model_name, qdrant_vector_dim=8)


def manifest(count=1):
    return IndexManifest(FakeEmbedder.model_name, 8, CHUNKER_VERSION, '2026-10-10T00:00:00+00:00', count)


def test_manifest_roundtrip(tmp_path):
    seed(DocumentStorageManager(tmp_path))
    write_manifest(tmp_path, manifest())
    assert read_manifest(tmp_path) == manifest()
    assert check_consistency(settings(), 1, 1, storage_root=tmp_path).ok


@pytest.mark.parametrize(('change', 'reason'), [
    ({'embedding_model': 'another/model'}, 'model mismatch'),
    ({'embedding_dim': 9}, 'dim mismatch'),
    ({'chunker_version': 'old'}, 'chunker version mismatch'),
    ({'chunk_count': 2}, 'count mismatch'),
])
def test_manifest_mismatches(tmp_path, change, reason):
    write_manifest(tmp_path, replace(manifest(), **change))
    report = check_consistency(settings(), 1, 1, storage_root=tmp_path)
    assert not report.ok
    assert any(reason in entry for entry in report.reasons)


def test_missing_collection_and_manifest(tmp_path):
    report = check_consistency(settings(), None, 1, storage_root=tmp_path)
    assert not report.ok
    assert 'collection missing' in report.reasons
    assert 'manifest missing' in report.reasons


def seed(storage, legacy=False, count=1):
    chunks = [Chunk(id=f'c{i}', document_id='doc', text=f'answer {i}', chunk_index=i,
                    metadata={'tenant_id': 'team', 'page': 2}, embedding=[0.1] * 8)
              for i in range(count)]
    storage.save_document(Document(id='doc', title='Example', text='answer', source='manual'), chunks, [], [])
    if legacy:
        path = storage.chunks_dir / 'doc.json'
        records = json.loads(path.read_text())
        for record in records:
            record['embedding'] = [0.1] * 8
        path.write_text(json.dumps(records))
    return chunks


def test_disk_drops_embeddings_and_ignores_legacy(tmp_path):
    storage = DocumentStorageManager(tmp_path)
    seed(storage)
    assert 'embedding' not in json.loads((storage.chunks_dir / 'doc.json').read_text())[0]
    seed(storage, legacy=True)
    assert storage.load_all_chunks()[0].embedding is None
    assert 'embedding' not in storage.get_document('doc')['chunks'][0]
    write_manifest(tmp_path, manifest())
    report = check_consistency(settings(), 1, 1, storage_root=tmp_path)
    assert not report.ok
    assert 'legacy embeddings require reindex' in report.reasons


def test_reindex_restores_consistency_and_is_idempotent(tmp_path):
    storage = DocumentStorageManager(tmp_path)
    seed(storage, legacy=True, count=65)
    with closing(QdrantClient(':memory:')) as client:
        reindex(storage, client, settings(), FakeEmbedder(8))
        assert client.count(settings().qdrant_collection, exact=True).count == 65
        assert check_consistency(settings(), 65, 65, storage_root=tmp_path).ok
        assert all(c.embedding is None for c in storage.load_all_chunks())
        reindex(storage, client, settings(), FakeEmbedder(8))
        assert client.count(settings().qdrant_collection, exact=True).count == 65
        points, _ = client.scroll(settings().qdrant_collection, limit=1)
        assert points[0].payload['metadata'] == {'tenant_id': 'team', 'page': 2}


def test_reindex_resumes_after_failed_batch(tmp_path, monkeypatch):
    storage = DocumentStorageManager(tmp_path)
    seed(storage, legacy=True, count=65)
    with closing(QdrantClient(':memory:')) as client:
        upsert = client.upsert
        calls = 0

        def fail_second(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError('interrupted')
            return upsert(*args, **kwargs)

        monkeypatch.setattr(client, 'upsert', fail_second)
        with pytest.raises(RuntimeError, match='interrupted'):
            reindex(storage, client, settings(), FakeEmbedder(8))
        assert read_manifest(tmp_path) is None
        assert storage.has_legacy_embeddings()
        monkeypatch.setattr(client, 'upsert', upsert)
        reindex(storage, client, settings(), FakeEmbedder(8), resume=True)
        assert check_consistency(settings(), 65, 65, storage_root=tmp_path).ok


def test_reindex_refuses_corrupt_disk_before_deleting_collection(tmp_path):
    storage = DocumentStorageManager(tmp_path)
    (storage.chunks_dir / 'bad.json').write_text('invalid json')
    with closing(QdrantClient(':memory:')) as client:
        with pytest.raises(ValueError):
            reindex(storage, client, settings(), FakeEmbedder(8))
        assert not client.collection_exists(settings().qdrant_collection)


def test_qdrant_disk_count_mismatch(tmp_path):
    write_manifest(tmp_path, manifest())
    report = check_consistency(settings(), 0, 1, storage_root=tmp_path)
    assert not report.ok
    assert any('Qdrant=0, disk=1' in entry for entry in report.reasons)


def test_malformed_manifest_fails_closed(tmp_path):
    (tmp_path / 'index_manifest.json').write_text('{')
    assert not check_consistency(settings(), 0, 0, storage_root=tmp_path).ok


def test_resume_refuses_changed_corpus(tmp_path, monkeypatch):
    storage = DocumentStorageManager(tmp_path)
    seed(storage, count=1)
    with closing(QdrantClient(':memory:')) as client:
        original = client.upsert
        def offline(*args, **kwargs):
            raise RuntimeError('offline')

        monkeypatch.setattr(client, 'upsert', offline)
        with pytest.raises(RuntimeError, match='offline'):
            reindex(storage, client, settings(), FakeEmbedder(8))
        seed(storage, count=2)
        monkeypatch.setattr(client, 'upsert', original)
        with pytest.raises(ValueError, match='source/configuration changed'):
            reindex(storage, client, settings(), FakeEmbedder(8), resume=True)
        assert client.count(settings().qdrant_collection, exact=True).count == 0


def test_empty_corpus_has_valid_manifest(tmp_path):
    storage = DocumentStorageManager(tmp_path)
    with closing(QdrantClient(':memory:')) as client:
        result = reindex(storage, client, settings(), FakeEmbedder(8))
        assert result.chunk_count == 0
        assert check_consistency(settings(), 0, 0, storage_root=tmp_path).ok


def test_cli_cancel_does_not_create_embedder_or_client(tmp_path, monkeypatch):
    import scripts.reindex as script

    monkeypatch.setattr('sys.argv', ['reindex.py', '--storage-root', str(tmp_path)])
    monkeypatch.setattr('builtins.input', lambda _: 'no')
    monkeypatch.setattr(script, 'FastEmbedEmbedder', lambda *args, **kwargs: pytest.fail('model must not load'))
    monkeypatch.setattr(script, 'QdrantClient', lambda *args, **kwargs: pytest.fail('client must not connect'))
    assert script.main() == 1


@pytest.mark.parametrize('records', ['[{}]', '{}', 'null'])
def test_invalid_disk_record_cannot_pass_zero_counts(tmp_path, records):
    storage = DocumentStorageManager(tmp_path)
    (storage.chunks_dir / 'broken.json').write_text(records)
    write_manifest(tmp_path, manifest(count=0))
    report = check_consistency(settings(), 0, 0, storage_root=tmp_path)
    assert not report.ok
    assert 'disk records unreadable' in report.reasons


def interrupted_rebuild(storage, client, monkeypatch):
    seed(storage, count=65)
    original = client.upsert
    calls = 0

    def fail_second(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError('interrupted')
        return original(*args, **kwargs)

    monkeypatch.setattr(client, 'upsert', fail_second)
    with pytest.raises(RuntimeError, match='interrupted'):
        reindex(storage, client, settings(), FakeEmbedder(8))
    monkeypatch.setattr(client, 'upsert', original)


@pytest.mark.parametrize('offset', [-1, 66, 1, '64', True])
def test_resume_rejects_invalid_checkpoint_offset(tmp_path, monkeypatch, offset):
    storage = DocumentStorageManager(tmp_path)
    with closing(QdrantClient(':memory:')) as client:
        interrupted_rebuild(storage, client, monkeypatch)
        path = tmp_path / 'reindex_checkpoint.json'
        checkpoint = json.loads(path.read_text())
        checkpoint['offset'] = offset
        path.write_text(json.dumps(checkpoint))
        with pytest.raises(ValueError, match='offset'):
            reindex(storage, client, settings(), FakeEmbedder(8), resume=True)
        assert read_manifest(tmp_path) is None


def test_resume_rejects_replacement_points_with_same_count(tmp_path, monkeypatch):
    from qdrant_client.models import PointIdsList, PointStruct

    from services.ingestion.vector_store import point_id

    storage = DocumentStorageManager(tmp_path)
    with closing(QdrantClient(':memory:')) as client:
        interrupted_rebuild(storage, client, monkeypatch)
        client.delete(settings().qdrant_collection,
                      PointIdsList(points=[point_id('c0')]), wait=True)
        client.upsert(settings().qdrant_collection, points=[
            PointStruct(id=point_id('unrelated'), vector=[1.] + [0.] * 7,
                        payload={'text': 'unrelated'}),
        ], wait=True)
        assert client.count(settings().qdrant_collection, exact=True).count == 64
        with pytest.raises(ValueError, match='previously written points missing'):
            reindex(storage, client, settings(), FakeEmbedder(8), resume=True)
        assert read_manifest(tmp_path) is None


@pytest.mark.parametrize('explicit_default', [False, True])
def test_cli_local_backend_cannot_publish_default_manifest(tmp_path, monkeypatch, explicit_default):
    import scripts.reindex as script

    monkeypatch.setattr(script, 'get_default_storage_root', lambda: tmp_path)
    argv = ['reindex.py', '--qdrant-path', str(tmp_path / 'local'), '--yes']
    if explicit_default:
        argv.extend(['--storage-root', str(tmp_path)])
    monkeypatch.setattr('sys.argv', argv)
    monkeypatch.setattr(script, 'FastEmbedEmbedder', lambda *args, **kwargs: pytest.fail('model must not load'))
    monkeypatch.setattr(script, 'QdrantClient', lambda *args, **kwargs: pytest.fail('client must not connect'))
    with pytest.raises(SystemExit) as error:
        script.main()
    assert error.value.code == 2
    assert not (tmp_path / 'index_manifest.json').exists()


def test_cli_local_backend_writes_only_isolated_manifest(tmp_path, monkeypatch):
    import scripts.reindex as script

    default_root = tmp_path / 'default-storage'
    isolated_root = tmp_path / 'isolated-storage'
    write_manifest(default_root, manifest())
    original_manifest = (default_root / 'index_manifest.json').read_bytes()
    seed(DocumentStorageManager(isolated_root))
    monkeypatch.setattr(script, 'get_default_storage_root', lambda: default_root)
    monkeypatch.setattr(script, 'get_settings', settings)
    monkeypatch.setattr(script, 'FastEmbedEmbedder', lambda *args, **kwargs: FakeEmbedder(8))
    monkeypatch.setattr('sys.argv', [
        'reindex.py', '--qdrant-path', str(tmp_path / 'local-qdrant'),
        '--storage-root', str(isolated_root), '--yes',
    ])
    assert script.main() == 0
    assert read_manifest(isolated_root).chunk_count == 1
    assert (default_root / 'index_manifest.json').read_bytes() == original_manifest
