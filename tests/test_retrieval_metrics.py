"""Unit tests for the retrieval quality metrics used by scripts/retrieval_check.py."""

from packages.core.models import Chunk
from scripts.retrieval_check import hit_at_k, reciprocal_rank
from services.rag_engine.retrieval.hybrid import RankedChunk


def _ranked(chunk_id: str, text: str, filename: str) -> RankedChunk:
    chunk = Chunk(
        id=chunk_id,
        document_id="d1",
        text=text,
        metadata={"source": filename, "title": "Doc"},
    )
    return RankedChunk(chunk=chunk, rank=1, scores={"final": 0.03})


def test_hit_requires_expected_doc_and_phrase():
    chunks = [
        _ranked("a", "unrelated text", "other.md"),
        _ranked("b", "Employees get 10 days of paid sick leave", "handbook.md"),
    ]
    assert hit_at_k(chunks, "handbook.md", ["10 days of paid sick leave"], k=5)
    assert not hit_at_k(chunks, "handbook.md", ["20 days of vacation"], k=5)
    assert not hit_at_k(chunks, "missing.md", ["10 days of paid sick leave"], k=5)


def test_hit_respects_k():
    chunks = [_ranked("a", "no match", "handbook.md"), _ranked("b", "10 days of paid sick leave", "handbook.md")]
    assert not hit_at_k(chunks, "handbook.md", ["10 days of paid sick leave"], k=1)
    assert hit_at_k(chunks, "handbook.md", ["10 days of paid sick leave"], k=2)


def test_reciprocal_rank_uses_first_qualifying_position():
    chunks = [
        _ranked("a", "no match", "handbook.md"),
        _ranked("b", "the answer lives here", "handbook.md"),
    ]
    assert reciprocal_rank(chunks, "handbook.md", ["the answer lives here"]) == 0.5
    assert reciprocal_rank(chunks, "handbook.md", ["nothing like that"]) == 0.0
