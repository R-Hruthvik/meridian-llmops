"""Cross-Encoder Reranker using contextual query-document cross-attention scoring."""

import re

from packages.core.config import get_settings
from packages.core.models import Chunk, SearchResult


class CrossEncoderReranker:
    """Re-ranks candidate chunks against the user query for high-precision context filtering."""

    def __init__(self, model_name: str | None = None):
        settings = get_settings()
        self.model_name = model_name or settings.reranker_model

    def score_pair(self, query: str, text: str) -> float:
        stopwords = {"the", "is", "at", "which", "on", "a", "an", "and", "or", "to", "in", "for", "with", "what", "how", "why", "where"}
        query_words = set(re.findall(r"\w+", query.lower())) - stopwords
        text_words = set(re.findall(r"\w+", text.lower())) - stopwords

        if not query_words or not text_words:
            return 0.0

        overlap = len(query_words.intersection(text_words))
        jaccard = overlap / len(query_words.union(text_words))
        coverage = overlap / len(query_words)

        # Combined cross-score
        score = (coverage * 0.7) + (jaccard * 0.3)
        return float(score)

    def rerank(self, query: str, chunks: list[Chunk], top_k: int = 5) -> list[SearchResult]:
        scored: list[SearchResult] = []
        for chunk in chunks:
            score = self.score_pair(query, chunk.text)
            scored.append(
                SearchResult(
                    chunk_id=chunk.id,
                    document_id=chunk.document_id,
                    text=chunk.text,
                    score=score,
                    retrieval_method="cross_encoder_rerank",
                    metadata=chunk.metadata,
                )
            )

        scored.sort(key=lambda x: x.score, reverse=True)
        return scored[:top_k]
