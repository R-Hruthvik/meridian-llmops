"""BM25 Sparse Lexical Search Index."""

import re

from rank_bm25 import BM25Okapi

from packages.core.models import Chunk, SearchResult


def tokenize(text: str) -> list[str]:
    # Alphanumeric word tokenization keeping error codes and symbols together
    return re.findall(r"[a-zA-Z0-9_\-]+", text.lower())


class BM25Index:
    """BM25 sparse index over document chunks for high-recall keyword search."""

    def __init__(self, chunks: list[Chunk]):
        self.chunks = chunks
        self.chunk_map: dict[str, Chunk] = {c.id: c for c in chunks}
        self.corpus = [tokenize(c.text) for c in chunks]
        self.bm25 = BM25Okapi(self.corpus) if self.corpus else None

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
