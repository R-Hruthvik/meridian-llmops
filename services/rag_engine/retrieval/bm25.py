"""BM25 Sparse Lexical Search Index."""

import re
from collections import defaultdict

from rank_bm25 import BM25Okapi

from packages.core.models import Chunk, SearchResult


def tokenize(text: str) -> list[str]:
    # Alphanumeric word tokenization keeping error codes and symbols together
    return re.findall(r"[a-zA-Z0-9_\-]+", text.lower())


def index_text(chunk: Chunk) -> str:
    """Text indexed by BM25: contextual header plus chunk text.

    The header carries the same title/heading context the embedder sees, so
    lexical and dense retrieval operate on comparable strings.
    """
    header = " > ".join(part for part in (chunk.metadata.get("title"), chunk.section_heading) if part)
    return f"{header}\n{chunk.text}" if header else chunk.text


class BM25Index:
    """BM25 sparse index over document chunks for high-recall keyword search."""

    def __init__(self, chunks: list[Chunk] | None = None):
        self.chunks = chunks or []
        self.chunk_map: dict[str, Chunk] = {c.id: c for c in self.chunks}
        self._corpus: list[list[str]] = []
        self._doc_lengths: list[int] = []
        self._df: dict[str, int] = defaultdict(int)
        self._avgdl: float = 0.0
        self._tenant_indexes: dict[str, tuple[BM25Okapi, list[int]]] = {}
        self.corpus = self._corpus  # backward compat alias
        self.bm25 = None
        if self.chunks:
            self._build_index()

    def chunk_of(self, chunk_id: str) -> Chunk | None:
        """Return the disk-record chunk for an id, or None if the corpus lacks it."""
        return self.chunk_map.get(chunk_id)

    def _build_index(self) -> None:
        """Build full index from current corpus state."""
        self._corpus = [tokenize(index_text(c)) for c in self.chunks]
        self._doc_lengths = [len(tokens) for tokens in self._corpus]
        self._df.clear()
        for tokens in self._corpus:
            for token in set(tokens):
                self._df[token] += 1
        self._avgdl = sum(self._doc_lengths) / len(self._doc_lengths) if self._doc_lengths else 0.0
        self.bm25 = BM25Okapi(self._corpus) if self._corpus else None
        self._build_tenant_indexes()

    def _build_tenant_indexes(self) -> None:
        """Build the tenant-local BM25 statistics used by filtered searches."""
        tenant_positions: dict[str, list[int]] = defaultdict(list)
        for position, chunk in enumerate(self.chunks):
            tenant_positions[str(chunk.metadata.get("tenant_id", "default"))].append(position)
        self._tenant_indexes = {
            tenant: (BM25Okapi([self._corpus[position] for position in positions]), positions)
            for tenant, positions in tenant_positions.items()
        }

    def add_chunks(self, new_chunks: list[Chunk]) -> None:
        """Incrementally add chunks without full rebuild."""
        start_idx = len(self.chunks)
        self.chunks.extend(new_chunks)
        self.chunk_map.update({c.id: c for c in new_chunks})

        for chunk in new_chunks:
            tokens = tokenize(index_text(chunk))
            self._corpus.append(tokens)
            self._doc_lengths.append(len(tokens))

        for tokens in self._corpus[start_idx:]:
            for token in set(tokens):
                self._df[token] += 1

        total_length = sum(self._doc_lengths)
        self._avgdl = total_length / len(self._doc_lengths) if self._doc_lengths else 0.0
        self.bm25 = BM25Okapi(self._corpus) if self._corpus else None
        self._build_tenant_indexes()

    def search(
        self, query: str, top_k: int = 5, tenant_id: str | None = None
    ) -> list[SearchResult]:
        if not self.bm25 or not self.chunks:
            return []

        query_tokens = tokenize(query)
        if not query_tokens:
            return []

        if tenant_id is None:
            positions = list(range(len(self._corpus)))
            index = self.bm25
        else:
            tenant_index = self._tenant_indexes.get(tenant_id)
            if tenant_index is None:
                return []
            index, positions = tenant_index

        doc_scores = index.get_scores(query_tokens)
        scored_indices = sorted(
            ((positions[position], score) for position, score in enumerate(doc_scores)),
            key=lambda x: x[1],
            reverse=True,
        )

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
