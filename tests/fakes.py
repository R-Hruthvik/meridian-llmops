"""Deterministic lightweight doubles used only by unit tests."""

import asyncio
import hashlib

import numpy as np
from qdrant_client import QdrantClient

from services.ingestion.vector_store import QdrantChunkStore


def make_vector_store(embedder):
    store = QdrantChunkStore(QdrantClient(":memory:"), "test_chunks", embedder.dim)
    store.ensure_collection()
    return store


class FakeEmbedder:
    model_name = "test/sha256"

    def __init__(self, dim: int = 1024):
        self.dim = dim

    def embed_query(self, text: str) -> np.ndarray:
        vector = np.zeros(self.dim, dtype=np.float32)
        for index, token in enumerate(text.lower().split()):
            coordinate = (
                int.from_bytes(hashlib.sha256(token.encode()).digest()[:8], "big") % self.dim
            )
            vector[coordinate] += 1 / (index + 1)
        norm = np.linalg.norm(vector)
        return vector / norm if norm else vector

    def embed_passages(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.empty((0, self.dim), dtype=np.float32)
        return np.asarray([self.embed_query(text) for text in texts], dtype=np.float32)


class FakeLLM:
    """Deterministic prompt-aware LLM double for local query tests."""

    def __init__(self, content: str | None = None):
        self.content = content
        self.calls: list[dict] = []

    async def chat_completion(self, **kwargs):
        self.calls.append(kwargs)
        messages = kwargs.get("messages", [])
        user_content = "\n".join(
            message.get("content", "") for message in messages if message.get("role") == "user"
        )
        if self.content is None:
            import re

            sources = re.findall(
                r"<source_text>\n(.*?)\n</source_text>", user_content, flags=re.DOTALL
            )
            content = " ".join(sources) or "Test response."
        else:
            content = self.content
        return {
            "choices": [{"message": {"role": "assistant", "content": content}}],
            "provider": kwargs.get("provider", "fake"),
            "model": kwargs.get("model", "fake-model"),
            "usage": {"prompt_tokens": 7, "completion_tokens": 5, "total_tokens": 12},
            "raw_response": {"choices": [{"message": {"content": content}}]},
        }


class FakeStreamingLLM(FakeLLM):
    """FakeLLM that also streams deltas, optionally blocking mid-generation on a gate.

    ``gate`` is awaited before the second delta is produced, so a caller can prove
    that an earlier delta was delivered while generation was still in flight.
    """

    def __init__(self, deltas: list[str], gate: asyncio.Event | None = None):
        super().__init__(content="".join(deltas))
        self.deltas = deltas
        self.gate = gate
        self.stream_calls: list[dict] = []
        self.unary_calls: list[dict] = []
        self.last_response: dict | None = None

    async def chat_completion(self, **kwargs):
        self.unary_calls.append(kwargs)
        return await super().chat_completion(**kwargs)

    async def chat_completion_stream(self, **kwargs):
        self.stream_calls.append(kwargs)
        for index, delta in enumerate(self.deltas):
            if self.gate is not None and index == 1:
                await asyncio.wait_for(self.gate.wait(), timeout=5)
            await asyncio.sleep(0)
            yield delta
        self.last_response = {
            "provider": kwargs.get("provider", "fake"),
            "model": kwargs.get("model", "fake-model"),
        }
