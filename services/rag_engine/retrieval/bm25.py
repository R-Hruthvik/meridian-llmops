"""BM25 Sparse Lexical Search Index."""

import re
from collections import defaultdict

from rank_bm25 import BM25Okapi

from packages.core.models import Chunk, SearchResult


def tokenize(text: str) -> list[str]:
    # Alphanumeric word tokenization keeping error codes and symbols together
    return re.findall(r"[a-zA-Z0-9_\-]+", text.lower())


class BM25Index:
    """BM25 sparse index over document chunks for high-recall keyword search."""

    def __init__(self, chunks: list[Chunk] | None = None):
        self.chunks = chunks or []
        self.chunk_map: dict[str, Chunk] = {c.id: c for c in self.chunks}
        self._corpus: list[list[str]] = []
        self._doc_lengths: list[int] = []
        self._df: dict[str, int] = defaultdict(int)
        self._avgdl: float = 0.0
        self.corpus = self._corpus  # backward compat alias
        self.bm25 = None
        if self.chunks:
            self._build_index()

    def _build_index(self) -> None:
        """Build full index from current corpus state."""
        self._corpus = [tokenize(c.text) for c in self.chunks]
        self._doc_lengths = [len(tokens) for tokens in self._corpus]
        self._df.clear()
        for tokens in self._corpus:
            for token in set(tokens):
                self._df[token] += 1
        self._avgdl = sum(self._doc_lengths) / len(self._doc_lengths) if self._doc_lengths else 0.0
        self.bm25 = BM25Okapi(self._corpus) if self._corpus else None

    def add_chunks(self, new_chunks: list[Chunk]) -> None:
        """Incrementally add chunks without full rebuild."""
        start_idx = len(self.chunks)
        self.chunks.extend(new_chunks)
        self.chunk_map.update({c.id: c for c in new_chunks})

        for chunk in new_chunks:
            tokens = tokenize(chunk.text)
            self._corpus.append(tokens)
            self._doc_lengths.append(len(tokens))

        # Update document frequencies
        for tokens in self._corpus[start_idx:]:
            for token in set(tokens):
                self._df[token] += 1

        # Update average document length
        total_length = sum(self._doc_lengths)
        self._avgdl = total_length / len(self._doc_lengths) if self._doc_lengths else 0.0

        # Rebuild BM25Okapi with updated corpus
        self.bm25 = BM25Okapi(self._corpus) if self._corpus else None

    def search(self, query: str, top_k: int = 5) -> list[SearchResult]:
        if not self.bm25 or not self.chunks:
            return []

        query_tokens = tokenize(query)
        if not query_tokens:
            return []

        doc_scores = self.bm25.get_scores(query_tokens)
        scored_indices = sorted(enumerate(doc_scores), key=lambda x: x[1], reverse=True)

        results: list[SearchResult] = []
        for idx, score in scored_indices[:top_k]:
            if score <= 0.0:
                continue
            chunk = self.chunks[idx]
            results.append(
                SearchResult(
                    chunk_id=chunk.id,
                    document_id=chunk.document_id,
                    text=chunk.text,
                    score=float(score),
                    retrieval_method="sparse_bm25",
                    metadata=chunk.metadata,
                )
            )
        return results
