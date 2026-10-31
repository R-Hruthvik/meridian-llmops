"""Reciprocal Rank Fusion (RRF) for combining dense and sparse retrieval rankings."""

from collections import defaultdict
from dataclasses import dataclass, field


@dataclass(frozen=True)
class FusedCandidate:
    """One chunk after fusion: its RRF score plus per-stage ranks and raw scores."""

    chunk_id: str
    rrf: float
    ranks: dict[str, int] = field(default_factory=dict)
    scores: dict[str, float] = field(default_factory=dict)


def reciprocal_rank_fusion(
    dense: list[tuple[str, float]],
    sparse: list[tuple[str, float]],
    k: int = 60,
) -> list[FusedCandidate]:
    """Combine two rankings with Score(d) = sum(1 / (k + rank_i(d))), ranks 1-based.

    Per-stage ranks and raw scores are preserved so callers (and the retrieval
    debug endpoint) can see where each candidate came from.
    """
    rrf_scores: dict[str, float] = defaultdict(float)
    ranks: dict[str, dict[str, int]] = defaultdict(dict)
    scores: dict[str, dict[str, float]] = defaultdict(dict)

    for name, rank_list in (("dense", dense), ("bm25", sparse)):
        for rank, (doc_id, score) in enumerate(rank_list, start=1):
            rrf_scores[doc_id] += 1.0 / (k + rank)
            ranks[doc_id][name] = rank
            scores[doc_id][name] = score

    ordered = sorted(rrf_scores.items(), key=lambda item: item[1], reverse=True)
    return [
        FusedCandidate(
            chunk_id=doc_id, rrf=score, ranks=dict(ranks[doc_id]), scores=dict(scores[doc_id])
        )
        for doc_id, score in ordered
    ]
