"""Dense Vector Store Manager for Qdrant with in-memory fallback for local testing."""

import logging

import numpy as np

from packages.core.config import get_settings
from packages.core.models import Chunk, SearchResult

logger = logging.getLogger("meridian.ingestion.vector_store")


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

        # Local in-memory storage for test isolation / fallback cache
        self._memory_chunks: dict[str, Chunk] = {}
        self._memory_vectors: dict[str, np.ndarray] = {}

        # Qdrant client handling
        self._qdrant_available: bool = False
        self._qdrant_fallback: bool = False
        self.client: object | None = None

        if not self.in_memory:
            try:
                from qdrant_client import QdrantClient  # type: ignore[import-untyped]
                from qdrant_client.models import Distance, VectorParams  # type: ignore[import-untyped]  # noqa: I001
            except Exception as e:  # noqa: BLE001
                logger.warning("qdrant-client not installed - using in-memory fallback: %s", e)
                return
            try:
                self.client = QdrantClient(
                    host=self.settings.qdrant_host,
                    port=self.settings.qdrant_port,
                    timeout=5,
                )
                # Test connectivity
                self.client.get_collections()  # type: ignore[attr-defined]
                # Ensure collection exists
                try:
                    self.client.get_collection(collection_name=self.collection_name)  # type: ignore[attr-defined]
                except Exception:  # noqa: BLE001
                    self.client.create_collection(  # type: ignore[attr-defined]
                        collection_name=self.collection_name,
                        vectors_config=VectorParams(size=self.dim, distance=Distance.COSINE),
                    )
                    logger.info("Created Qdrant collection %s", self.collection_name)
                self._qdrant_available = True
                logger.info(
                    "Qdrant connected at %s:%s collection=%s",
                    self.settings.qdrant_host,
                    self.settings.qdrant_port,
                    self.collection_name,
                )
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    "Qdrant unavailable at %s:%s - using in-memory fallback: %s",
                    self.settings.qdrant_host,
                    self.settings.qdrant_port,
                    e,
                )
                self.client = None
                self._qdrant_available = False
                self._qdrant_fallback = True
        else:
            logger.info("VectorStore in-memory mode (forced)")

    def index_chunks(self, chunks: list[Chunk]) -> int:
        # Always populate in-memory cache for fallback reads
        for chunk in chunks:
            if not chunk.embedding:
                chunk.embedding = generate_embedding(chunk.text, dim=self.dim)
            self._memory_chunks[chunk.id] = chunk
            self._memory_vectors[chunk.id] = np.array(chunk.embedding, dtype=np.float32)

        if self._qdrant_available and self.client is not None:
            try:
                from qdrant_client.models import PointStruct  # type: ignore[import-untyped]

                points = []
                for chunk in chunks:
                    payload = {
                        "document_id": chunk.document_id,
                        "chunk_id": chunk.id,
                        "chunk_index": chunk.chunk_index,
                        "section_heading": chunk.section_heading,
                        "text": chunk.text,
                        "source": chunk.metadata.get("source", chunk.document_id) if chunk.metadata else chunk.document_id,
                    }
                    points.append(
                        PointStruct(
                            id=chunk.id,
                            vector=chunk.embedding or generate_embedding(chunk.text, dim=self.dim),
                            payload=payload,
                        )
                    )
                self.client.upsert(collection_name=self.collection_name, points=points)  # type: ignore[attr-defined]
            except Exception as e:  # noqa: BLE001
                logger.warning("Qdrant index_chunks failed, falling back to in-memory: %s", e)
                self._qdrant_fallback = True
        return len(chunks)

    def search(self, query: str, top_k: int = 5) -> list[SearchResult]:
        if self._qdrant_available and self.client is not None:
            try:
                query_vec = generate_embedding(query, dim=self.dim)
                # Use search API (qdrant-client 1.8) with fallback to query_points
                try:
                    hits = self.client.search(  # type: ignore[attr-defined]
                        collection_name=self.collection_name,
                        query_vector=query_vec,
                        limit=top_k,
                    )
                except Exception:  # noqa: BLE001
                    # Newer client uses query_points
                    resp = self.client.query_points(  # type: ignore[attr-defined]
                        collection_name=self.collection_name,
                        query=query_vec,
                        limit=top_k,
                    )
                    hits = getattr(resp, "points", resp)

                results: list[SearchResult] = []
                for hit in hits:  # type: ignore[assignment]
                    payload = getattr(hit, "payload", {}) or {}
                    if isinstance(hit, dict):
                        payload = hit.get("payload", {})
                        score = hit.get("score", 0.0)
                        hit_id = str(hit.get("id", payload.get("chunk_id", "")))
                    else:
                        score = getattr(hit, "score", 0.0)
                        hit_id = str(getattr(hit, "id", payload.get("chunk_id", "")))
                    text = payload.get("text", "")
                    if not text and hit_id in self._memory_chunks:
                        text = self._memory_chunks[hit_id].text
                    results.append(
                        SearchResult(
                            chunk_id=payload.get("chunk_id", hit_id),
                            document_id=payload.get("document_id", ""),
                            text=text,
                            score=float(score),
                            retrieval_method="dense_vector",
                            metadata=payload,
                        )
                    )
                if results:
                    return results
            except Exception as e:  # noqa: BLE001
                logger.warning("Qdrant search failed, falling back to in-memory: %s", e)

        # In-memory fallback scoring
        query_vec_fallback = np.array(generate_embedding(query, dim=self.dim), dtype=np.float32)
        scores: list[tuple[str, float]] = []

        for chunk_id, vec in self._memory_vectors.items():
            dot = float(np.dot(query_vec_fallback, vec))
            scores.append((chunk_id, dot))

        scores.sort(key=lambda x: x[1], reverse=True)
        results_fallback: list[SearchResult] = []

        for chunk_id, score in scores[:top_k]:
            chunk = self._memory_chunks[chunk_id]
            results_fallback.append(
                SearchResult(
                    chunk_id=chunk.id,
                    document_id=chunk.document_id,
                    text=chunk.text,
                    score=score,
                    retrieval_method="dense_vector",
                    metadata=chunk.metadata,
                )
            )
        return results_fallback

    def get_all_chunks(self) -> list[Chunk]:
        return list(self._memory_chunks.values())

    def get_chunks_by_document(self, doc_id: str) -> list[Chunk]:
        return [c for c in self._memory_chunks.values() if c.document_id == doc_id]

    def delete_chunks_by_document(self, doc_id: str) -> int:
        to_delete = [c_id for c_id, c in self._memory_chunks.items() if c.document_id == doc_id]
        for c_id in to_delete:
            self._memory_chunks.pop(c_id, None)
            self._memory_vectors.pop(c_id, None)

        if self._qdrant_available and self.client is not None:
            try:
                from qdrant_client.models import FieldCondition, Filter, MatchValue  # type: ignore[import-untyped]  # noqa: I001

                self.client.delete(  # type: ignore[attr-defined]
                    collection_name=self.collection_name,
                    points_selector=Filter(
                        must=[FieldCondition(key="document_id", match=MatchValue(value=doc_id))]
                    ),
                )
            except Exception as e:  # noqa: BLE001
                logger.warning("Qdrant delete failed for %s: %s", doc_id, e)
        return len(to_delete)

    def clear(self) -> None:
        self._memory_chunks.clear()
        self._memory_vectors.clear()
        if self._qdrant_available and self.client is not None:
            try:
                # Delete and recreate collection for clean slate
                from qdrant_client.models import Distance, VectorParams  # type: ignore[import-untyped]

                try:
                    self.client.delete_collection(collection_name=self.collection_name)  # type: ignore[attr-defined]
                except Exception:  # noqa: BLE001
                    pass
                self.client.create_collection(  # type: ignore[attr-defined]
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(size=self.dim, distance=Distance.COSINE),
                )
            except Exception as e:  # noqa: BLE001
                logger.warning("Qdrant clear failed: %s", e)

    @property
    def is_fallback(self) -> bool:
        return self._qdrant_fallback or not self._qdrant_available and not self.in_memory
