"""Deterministic lightweight doubles used only by unit tests."""

import hashlib

import numpy as np
from qdrant_client import QdrantClient

from services.ingestion.vector_store import QdrantChunkStore


def make_vector_store(embedder):
    store = QdrantChunkStore(QdrantClient(':memory:'), 'test_chunks', embedder.dim)
    store.ensure_collection()
    return store


class FakeEmbedder:
    model_name = 'test/sha256'

    def __init__(self, dim: int = 1024):
        self.dim = dim

    def embed_query(self, text: str) -> np.ndarray:
        vector = np.zeros(self.dim, dtype=np.float32)
        for index, token in enumerate(text.lower().split()):
            coordinate = int.from_bytes(hashlib.sha256(token.encode()).digest()[:8], 'big') % self.dim
            vector[coordinate] += 1 / (index + 1)
        norm = np.linalg.norm(vector)
        return vector / norm if norm else vector

    def embed_passages(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.empty((0, self.dim), dtype=np.float32)
        return np.asarray([self.embed_query(text) for text in texts], dtype=np.float32)
