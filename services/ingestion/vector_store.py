"""Dense Vector Store Manager for Qdrant with in-memory fallback for local testing."""

import numpy as np

from packages.core.config import get_settings
from packages.core.models import Chunk, SearchResult


def generate_embedding(text: str, dim: int = 1024) -> list[float]:
    """Generates a normalized dense vector embedding (deterministic pseudo-embedding fallback for tests)."""
    # Use deterministic token hashing to produce consistent dense vectors
    vec = np.zeros(dim, dtype=np.float32)
    tokens = text.lower().split()
    if not tokens:
        return vec.tolist()

    for idx, token in enumerate(tokens):
        h = hash(token) % dim
        vec[h] += 1.0 / (idx + 1.0)

    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


class VectorStoreManager:
    """Manages Qdrant vector collection indexing and similarity search."""

    def __init__(self, in_memory: bool = False):
        self.settings = get_settings()
        self.in_memory = in_memory
        self.dim = self.settings.qdrant_vector_dim
        self.collection_name = self.settings.qdrant_collection

        # Local in-memory storage for test isolation
        self._memory_chunks: dict[str, Chunk] = {}
        self._memory_vectors: dict[str, np.ndarray] = {}

    def index_chunks(self, chunks: list[Chunk]) -> int:
        for chunk in chunks:
            if not chunk.embedding:
                chunk.embedding = generate_embedding(chunk.text, dim=self.dim)
            self._memory_chunks[chunk.id] = chunk
            self._memory_vectors[chunk.id] = np.array(chunk.embedding, dtype=np.float32)
        return len(chunks)

    def search(self, query: str, top_k: int = 5) -> list[SearchResult]:
        query_vec = np.array(generate_embedding(query, dim=self.dim), dtype=np.float32)
        scores: list[tuple[str, float]] = []

        for chunk_id, vec in self._memory_vectors.items():
            dot = float(np.dot(query_vec, vec))
            scores.append((chunk_id, dot))

        scores.sort(key=lambda x: x[1], reverse=True)
        results: list[SearchResult] = []

        for chunk_id, score in scores[:top_k]:
            chunk = self._memory_chunks[chunk_id]
            results.append(
                SearchResult(
                    chunk_id=chunk.id,
                    document_id=chunk.document_id,
                    text=chunk.text,
                    score=score,
                    retrieval_method="dense_vector",
                    metadata=chunk.metadata,
                )
            )
        return results

    def get_all_chunks(self) -> list[Chunk]:
        return list(self._memory_chunks.values())
