"""Contract and semantic checks for the production passage/query embedder."""

import json
import os
import subprocess
import sys

import numpy as np
import pytest


def test_embedder_contract_normalizes_and_uses_passage_query_methods(monkeypatch, tmp_path):
    from services.ingestion.embedder import FastEmbedEmbedder

    class Model:
        def __init__(self, model_name, cache_dir, **kwargs):
            assert model_name == 'test/model'
            assert cache_dir == str(tmp_path)

        def passage_embed(self, texts):
            return iter([np.array([3., 4.]) for _ in texts])

        def query_embed(self, text):
            return iter([np.array([0., 2.])])

    monkeypatch.setattr('fastembed.TextEmbedding', Model)
    embedder = FastEmbedEmbedder('test/model', cache_path=tmp_path, expected_dim=2)
    passages = embedder.embed_passages(['one', 'two'])
    assert passages.dtype == np.float32
    np.testing.assert_allclose(passages, [[.6, .8], [.6, .8]])
    np.testing.assert_array_equal(embedder.embed_query('question'), [0., 1.])
    assert embedder.embed_passages([]).shape == (0, 2)
    with pytest.raises(ValueError, match='dimension'):
        FastEmbedEmbedder('test/model', cache_path=tmp_path, expected_dim=3)


@pytest.fixture(scope='module')
def semantic_embedder():
    from services.ingestion.embedder import FastEmbedEmbedder

    return FastEmbedEmbedder('BAAI/bge-small-en-v1.5', expected_dim=384)


def test_embedder_dim_matches_config(semantic_embedder):
    from packages.core.config import get_settings

    assert semantic_embedder.dim == get_settings().qdrant_vector_dim
    assert semantic_embedder.model_name == get_settings().embedding_model
    assert semantic_embedder.embed_query('a question').shape == (384,)
    assert semantic_embedder.embed_passages(['a passage']).shape == (1, 384)


def test_query_passage_similarity(semantic_embedder):
    query = semantic_embedder.embed_query('What is the capital of France?')
    passages = semantic_embedder.embed_passages([
        'Paris is the capital city of France.',
        'Whales are large marine mammals that live in the ocean.',
    ])
    scores = passages @ query
    assert scores[0] > scores[1]


def test_embedder_deterministic_across_processes(semantic_embedder):
    code = (
        'import json; from services.ingestion.embedder import FastEmbedEmbedder; '
        "e=FastEmbedEmbedder('BAAI/bge-small-en-v1.5', expected_dim=384); "
        "print(json.dumps(e.embed_query('Qdrant vector database').tolist()))"
    )
    vectors = [json.loads(subprocess.check_output(
        [sys.executable, '-c', code], text=True, env=dict(os.environ, PYTHONHASHSEED=str(seed)),
    )) for seed in (1, 2)]
    np.testing.assert_array_equal(vectors[0], vectors[1])


def test_pipeline_reembeds_legacy_vectors(tmp_path):
    from packages.core.models import Chunk
    from services.ingestion.pipeline import IngestionPipeline
    from tests.fakes import FakeEmbedder, make_vector_store

    embedder = FakeEmbedder(8)
    chunk = Chunk(id='c1', document_id='d1', text='semantic answer', chunk_index=0, embedding=[1.] * 1024)
    store = make_vector_store(embedder)
    pipeline = IngestionPipeline(vector_store=store, embedder=embedder, storage_root=tmp_path)
    pipeline._index_chunks([chunk])
    assert store.dim == 8
    result = store.search(embedder.embed_query('semantic answer'), 5, 'default')[0]
    assert result.score == pytest.approx(1.)
    assert result.chunk.embedding is None


@pytest.mark.asyncio
async def test_app_lifespan_initializes_model_once(monkeypatch):
    from services.rag_engine import app as app_module
    from tests.fakes import FakeEmbedder

    initialized = []

    def create_embedder(model_name, cache_path, expected_dim):
        initialized.append((model_name, cache_path, expected_dim))
        return FakeEmbedder(expected_dim)

    async def init_db():
        pass

    monkeypatch.setattr(app_module.ingestion_pipeline, 'embedder', None)
    monkeypatch.setattr(app_module, 'FastEmbedEmbedder', create_embedder)
    monkeypatch.setattr(app_module, 'init_db', init_db)
    monkeypatch.setattr(app_module.ingestion_pipeline, 'load_persisted_knowledge_base', lambda: 0)
    previous = getattr(app_module.app.state, 'index_consistency', None)
    try:
        async with app_module.lifespan(app_module.app):
            assert app_module.ingestion_pipeline.embedder is not None
        async with app_module.lifespan(app_module.app):
            assert len(initialized) == 1
    finally:
        # The index gate reads app state, so restoring only the module global
        # would still leak the stubbed hydration verdict into later tests.
        app_module.app.state.index_consistency = previous
