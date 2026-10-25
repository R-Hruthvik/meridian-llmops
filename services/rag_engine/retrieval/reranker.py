"""Lexical and FastEmbed cross-encoder rerankers."""

import logging
import re

from fastembed.rerank.cross_encoder import TextCrossEncoder

from packages.core.config import get_settings
from packages.core.models import Chunk, SearchResult

logger = logging.getLogger(__name__)


class LexicalReranker:
    """word-overlap heuristic; not a learned model"""

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
                    retrieval_method="lexical_rerank",
                    metadata=chunk.metadata,
                )
            )

        scored.sort(key=lambda x: x.score, reverse=True)
        return scored[:top_k]


class CrossEncoderReranker:
    """Rerank chunks with a FastEmbed learned query-document cross-encoder.

    ``BAAI/bge-reranker-large`` is the configured target model, but the
    FastEmbed runtime only ships a subset of cross-encoders. When the requested
    model cannot be loaded we try the supported BGE variants and finally fall
    back to the lexical heuristic instead of raising during startup.
    """

    _FALLBACK_MODELS = ("BAAI/bge-reranker-base", "BAAI/bge-reranker-v2-m3", "Xenova/ms-marco-MiniLM-L-6-v2")

    def __init__(self, model_name: str | None = None, cache_path: str | None = None):
        settings = get_settings()
        requested = model_name or settings.reranker_model
        self.cache_path = cache_path or settings.fastembed_cache_path
        self._lexical = LexicalReranker()
        self._model = None
        self.model_name = requested

        candidates = [requested]
        candidates.extend(model for model in self._FALLBACK_MODELS if model not in candidates)
        for candidate in candidates:
            try:
                self._model = TextCrossEncoder(
                    model_name=candidate,
                    cache_dir=self.cache_path,
                    threads=4,
                )
                self.model_name = candidate
                return
            except Exception as error:  # noqa: BLE001 - model availability is optional
                logger.warning("Cross-encoder model %s unavailable: %s", candidate, error)
                continue

        logger.warning("No cross-encoder model could be loaded; using lexical fallback.")

    def rerank(self, query: str, chunks: list[Chunk], top_k: int = 5) -> list[SearchResult]:
        if self._model is None:
            return self._lexical.rerank(query, chunks, top_k)

        candidates = chunks[: max(20, 2 * top_k)]
        try:
            scores = self._model.rerank(query, [chunk.text for chunk in candidates], batch_size=64)
            scores = list(scores)
            if len(scores) != len(candidates):
                logger.warning("Cross-encoder score count mismatch; using lexical fallback")
                return self._lexical.rerank(query, chunks, top_k)
            ranked = [
                SearchResult(
                    chunk_id=chunk.id,
                    document_id=chunk.document_id,
                    text=chunk.text,
                    score=float(score),
                    retrieval_method="cross_encoder_rerank",
                    metadata=chunk.metadata,
                )
                for chunk, score in zip(candidates, scores)
            ]
        except Exception as error:  # noqa: BLE001 - degrade gracefully at query time
            logger.warning("Cross-encoder scoring failed; using lexical fallback: %s", error)
            return self._lexical.rerank(query, chunks, top_k)

        ranked.sort(key=lambda result: result.score, reverse=True)
        return ranked[:top_k]
