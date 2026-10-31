"""Normalized semantic passage and query embeddings backed by FastEmbed."""

from pathlib import Path
from typing import Protocol, cast

import numpy as np


class Embedder(Protocol):
    model_name: str
    dim: int

    def embed_passages(self, texts: list[str]) -> np.ndarray: ...

    def embed_query(self, text: str) -> np.ndarray: ...


class FastEmbedEmbedder:
    """Load and warm one model; callers retain this instance for the app lifetime."""

    def __init__(
        self,
        model_name: str,
        cache_path: Path | str = "storage/fastembed",
        expected_dim: int | None = None,
    ):
        from fastembed import TextEmbedding

        self.model_name = model_name
        self._model = TextEmbedding(model_name=model_name, cache_dir=str(cache_path), threads=4)
        probe = self._normalize(list(self._model.passage_embed(["Meridian model warmup"])))
        self.dim = probe.shape[1]
        if expected_dim is not None and self.dim != expected_dim:
            raise ValueError(
                f"Embedding dimension {self.dim} for {model_name} differs from configured dimension {expected_dim}"
            )

    @staticmethod
    def _normalize(vectors: list) -> np.ndarray:
        array = np.asarray(vectors, dtype=np.float32)
        norms = np.linalg.norm(array, axis=1, keepdims=True)
        return cast(np.ndarray, np.divide(array, norms, out=np.zeros_like(array), where=norms > 0))

    def embed_passages(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.empty((0, self.dim), dtype=np.float32)
        return self._normalize(list(self._model.passage_embed(texts)))

    def embed_query(self, text: str) -> np.ndarray:
        return cast(np.ndarray, self._normalize(list(self._model.query_embed(text)))[0])
