"""BM25 Sparse Lexical Search Index."""

import re
from collections import defaultdict

import numpy as np
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
    header = " > ".join(
        part for part in (chunk.metadata.get("title"), chunk.section_heading) if part
    )
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
        self._postings: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        self._tenant_indexes: dict[
            str, tuple[BM25Okapi, list[int], dict[str, tuple[np.ndarray, np.ndarray]]]
        ] = {}
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
        self._postings = self._build_postings(self.bm25) if self.bm25 else {}
        self._build_tenant_indexes()

    @staticmethod
    def _build_postings(index: BM25Okapi) -> dict[str, tuple[np.ndarray, np.ndarray]]:
        """Build sparse per-term BM25 weights for low-cost query scoring."""
        frequencies_by_token: dict[str, list[tuple[int, int]]] = defaultdict(list)
        for position, frequencies in enumerate(index.doc_freqs):
            for token, frequency in frequencies.items():
                frequencies_by_token[token].append((position, frequency))
        postings = {}
        for token, frequencies in frequencies_by_token.items():
            positions = np.fromiter((position for position, _ in frequencies), dtype=np.intp)
            token_frequencies = np.fromiter(
                (frequency for _, frequency in frequencies), dtype=np.float64
            )
            lengths = np.asarray(
                [index.doc_len[position] for position in positions], dtype=np.float64
            )
            weights = (
                token_frequencies
                * (index.k1 + 1)
                / (token_frequencies + index.k1 * (1 - index.b + index.b * lengths / index.avgdl))
            )
            postings[token] = (positions, weights)
        return postings

    def _build_tenant_indexes(self) -> None:
        """Build the tenant-local BM25 statistics used by filtered searches."""
        tenant_positions: dict[str, list[int]] = defaultdict(list)
        for position, chunk in enumerate(self.chunks):
            tenant_positions[str(chunk.metadata.get("tenant_id", "default"))].append(position)
        self._tenant_indexes = {}
        for tenant, positions in tenant_positions.items():
            index = BM25Okapi([self._corpus[position] for position in positions])
            self._tenant_indexes[tenant] = (index, positions, self._build_postings(index))

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
        self._postings = self._build_postings(self.bm25) if self.bm25 else {}
        self._build_tenant_indexes()

    def rebuild(self) -> None:
        """Rebuild the index from the current chunk list after corpus changes."""
        self.chunk_map = {c.id: c for c in self.chunks}
        self._build_index()

    def remove_chunks(self, chunk_ids: list[str]) -> None:
        """Evict chunks by id so deleted documents stop matching lexical queries."""
        removed = set(chunk_ids)
        if not removed:
            return
        self.chunks = [chunk for chunk in self.chunks if chunk.id not in removed]
        self.rebuild()

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
            postings = self._postings
        else:
            tenant_index = self._tenant_indexes.get(tenant_id)
            if tenant_index is None:
                return []
            index, positions, postings = tenant_index

        doc_scores = np.zeros(len(index.doc_len), dtype=np.float64)
        for token in query_tokens:
            idf = index.idf.get(token) or 0.0
            term_postings = postings.get(token)
            if idf == 0.0 or term_postings is None:
                continue
            term_positions, term_weights = term_postings
            doc_scores[term_positions] += idf * term_weights

        candidate_positions = np.flatnonzero(doc_scores > 0.0)
        if candidate_positions.size > top_k:
            threshold = np.partition(doc_scores[candidate_positions], -top_k)[-top_k]
            candidate_positions = candidate_positions[doc_scores[candidate_positions] >= threshold]
        scored_indices = sorted(
            (
                (positions[position], float(doc_scores[position]))
                for position in candidate_positions
            ),
            key=lambda item: (-item[1], item[0]),
        )[:top_k]

        results: list[SearchResult] = []
        for idx, score in scored_indices:
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
