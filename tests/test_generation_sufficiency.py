from services.rag_engine.generation.sufficiency import has_sufficient_context


def test_dense_score_at_threshold_is_sufficient():
    assert has_sufficient_context(
        "what is Qdrant",
        [{"scores": {"dense": 0.70, "bm25": 0.0}}],
        min_dense_score=0.70,
    )


def test_raw_bm25_hit_without_substantive_term_coverage_is_insufficient():
    assert not has_sufficient_context(
        "what is the stock price of Apple",
        [{"scores": {"dense": 0.2, "bm25": 3.2}}],
        min_dense_score=0.70,
    )


def test_bm25_identifier_match_is_sufficient():
    assert has_sufficient_context(
        "what does QdrantCloud do",
        [{"text": "QdrantCloud handles storage", "scores": {"dense": 0.2, "bm25": 0.3}}],
        min_dense_score=0.70,
    )


def test_bm25_requires_half_of_substantive_terms():
    assert has_sufficient_context(
        "explain Qdrant vector storage",
        [{"text": "Qdrant vector stores records", "scores": {"dense": 0.2, "bm25": 0.3}}],
        min_dense_score=0.70,
    )
