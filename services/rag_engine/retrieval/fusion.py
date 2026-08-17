"""Reciprocal Rank Fusion (RRF) for combining multi-source retrieval scores."""

from collections import defaultdict


def reciprocal_rank_fusion(
    ranked_lists: list[list[tuple[str, float]]],
    k: int = 60,
) -> list[tuple[str, float]]:
    """Combines rankings using RRF formula: Score(d) = sum(1 / (k + rank_i(d)))."""
    rrf_scores: dict[str, float] = defaultdict(float)

    for rank_list in ranked_lists:
        for rank, (doc_id, _) in enumerate(rank_list):
            rrf_scores[doc_id] += 1.0 / (k + rank + 1)

    sorted_results = sorted(rrf_scores.items(), key=lambda item: item[1], reverse=True)
    return sorted_results
