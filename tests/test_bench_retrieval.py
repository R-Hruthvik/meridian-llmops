"""Focused shape and input checks for the retrieval benchmark."""

import pytest

from scripts.bench_retrieval import make_queries, percentile, validate_corpus_shape


def test_percentiles_use_nearest_rank_for_latency_samples():
    assert percentile([1.0, 2.0, 3.0, 4.0], 50) == 2.0
    assert percentile([1.0, 2.0, 3.0, 4.0], 95) == 4.0
    assert percentile([1.0, 2.0, 3.0, 4.0], 99) == 4.0


def test_benchmark_requires_at_least_500_docs_and_5000_chunks():
    with pytest.raises(ValueError, match="500 documents"):
        validate_corpus_shape(499, 10)
    with pytest.raises(ValueError, match="5,000 chunks"):
        validate_corpus_shape(500, 9)


def test_benchmark_accepts_minimum_planned_corpus():
    validate_corpus_shape(500, 10)


def test_queries_follow_configured_corpus_dimensions():
    queries = make_queries(2, doc_count=600, chunks_per_doc=12)
    assert "MER-0000-00" in queries[0]
    assert "MER-0001-01" in queries[1]
