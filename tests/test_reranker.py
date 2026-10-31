from packages.core.models import Chunk
from packages.core.settings import Settings
from services.rag_engine.retrieval.hybrid import HybridRetriever
from services.rag_engine.retrieval.reranker import CrossEncoderReranker, LexicalReranker
from tests.fakes import FakeEmbedder, make_vector_store


def test_reranker_setting_defaults_to_none():
    assert Settings(_env_file=None).reranker == "none"


def test_reranker_settings_follow_environment(monkeypatch):
    monkeypatch.setenv("RERANKER", "cross_encoder")
    monkeypatch.setenv("RERANK_MODEL", "Xenova/ms-marco-MiniLM-L-12-v2")

    settings = Settings(_env_file=None)

    assert settings.reranker == "cross_encoder"
    assert settings.reranker_model == "Xenova/ms-marco-MiniLM-L-12-v2"


def test_lexical_reranker_is_explicitly_heuristic():
    reranker = LexicalReranker()
    chunks = [
        Chunk(id="a", document_id="d", text="unrelated passage"),
        Chunk(id="b", document_id="d", text="Qdrant vector database"),
    ]

    result = reranker.rerank("Qdrant vector", chunks, top_k=1)

    assert result[0].chunk_id == "b"
    assert result[0].retrieval_method == "lexical_rerank"
    assert "word-overlap heuristic; not a learned model" in (LexicalReranker.__doc__ or "")


def test_cross_encoder_uses_fastembed_scores_and_candidate_limit(monkeypatch):
    from services.rag_engine.retrieval import reranker as reranker_module

    calls = {}

    class FakeTextCrossEncoder:
        def __init__(self, model_name, cache_dir=None, threads=None):
            calls["init"] = (model_name, cache_dir, threads)

        def rerank(self, query, documents, batch_size=64):
            calls["rerank"] = (query, list(documents), batch_size)
            return iter(range(len(calls["rerank"][1])))

    monkeypatch.setattr(reranker_module, "TextCrossEncoder", FakeTextCrossEncoder)
    reranker = CrossEncoderReranker(model_name="test/model", cache_path="/model-cache")
    chunks = [Chunk(id=str(i), document_id="d", text=f"chunk {i}") for i in range(25)]

    result = reranker.rerank("query", chunks, top_k=3)

    assert calls["init"] == ("test/model", "/model-cache", 4)
    assert len(calls["rerank"][1]) == 20
    assert [item.chunk_id for item in result] == ["19", "18", "17"]
    assert result[0].retrieval_method == "cross_encoder_rerank"


def test_hybrid_retriever_limits_reranker_candidates():
    embedder = FakeEmbedder()
    vector_store = make_vector_store(embedder)
    sample_chunks = [
        Chunk(id=f"c{i}", document_id="d", text=f"gateway document {i}") for i in range(35)
    ]
    vector_store.upsert_chunks(
        sample_chunks, embedder.embed_passages([c.text for c in sample_chunks])
    )

    class RecordingReranker:
        def __init__(self):
            self.chunks = []
            self.requested_top_k = None

        def rerank(self, query, chunks, top_k):
            self.chunks = chunks
            self.requested_top_k = top_k
            from packages.core.models import SearchResult

            return [
                SearchResult(
                    chunk_id=chunk.id,
                    document_id=chunk.document_id,
                    text=chunk.text,
                    score=1.0,
                    retrieval_method="test_rerank",
                )
                for chunk in chunks[:top_k]
            ]

    reranker = RecordingReranker()
    retriever = HybridRetriever(embedder, vector_store, reranker=reranker)
    retriever.retrieve("gateway", top_k=12)

    assert len(reranker.chunks) == 24
    assert reranker.requested_top_k == 12
