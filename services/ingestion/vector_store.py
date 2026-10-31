"""Qdrant chunk persistence with explicit dependencies and no alternate backend."""

import uuid
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from qdrant_client import QdrantClient, models

from packages.core.errors import IndexMismatchError, IndexReadError, IndexWriteError
from packages.core.models import Chunk

# Stable across deployments: changing this value requires rebuilding the index.
POINT_NAMESPACE = uuid.UUID("67adac87-77a1-5d8d-901c-b99471d49131")


def point_id(chunk_id: str) -> str:
    return str(uuid.uuid5(POINT_NAMESPACE, chunk_id))


@dataclass(frozen=True)
class ChunkHit:
    chunk: Chunk
    score: float


class QdrantChunkStore:
    """Store complete chunk payloads; the caller owns client and embedder lifetimes."""

    def __init__(self, client: QdrantClient, collection_name: str, dim: int):
        self.client = client
        self.collection_name = collection_name
        self.dim = dim

    def _check_schema(self, collection: models.CollectionInfo) -> None:
        vectors = collection.config.params.vectors
        if (
            not isinstance(vectors, models.VectorParams)
            or vectors.size != self.dim
            or vectors.distance != models.Distance.COSINE
        ):
            raise IndexMismatchError(
                f"Collection {self.collection_name!r} requires unnamed cosine vectors "
                f"of dimension {self.dim}; found {vectors}. Run scripts/reindex.py."
            )

    def ensure_collection(self) -> None:
        try:
            if not self.client.collection_exists(self.collection_name):
                created = self.client.create_collection(
                    self.collection_name,
                    vectors_config=models.VectorParams(
                        size=self.dim, distance=models.Distance.COSINE
                    ),
                )
                if not created:
                    raise IndexWriteError(f"Qdrant did not create {self.collection_name!r}")
            collection = self.client.get_collection(self.collection_name)
            self._check_schema(collection)
            for field in ("document_id", "tenant_id", "filename"):
                schema = collection.payload_schema.get(field)
                if schema is not None:
                    if schema.data_type != models.PayloadSchemaType.KEYWORD:
                        raise IndexMismatchError(f"Payload index {field!r} must be keyword")
                    continue
                result = self.client.create_payload_index(
                    collection_name=self.collection_name,
                    field_name=field,
                    field_schema=models.PayloadSchemaType.KEYWORD,
                    wait=True,
                )
                self._require_completed(result)
        except (IndexMismatchError, IndexWriteError):
            raise
        except Exception as error:
            raise IndexWriteError(f"Qdrant collection initialization failed: {error}") from error

    @staticmethod
    def _filter(
        tenant_id: str | None = None,
        document_id: str | None = None,
        filters: Mapping[str, str] | None = None,
    ) -> models.Filter:
        # Separate mandatory conditions mean filters can never replace the tenant scope.
        must = [
            models.FieldCondition(key=key, match=models.MatchValue(value=value))
            for key, value in (filters or {}).items()
        ]
        if tenant_id is not None:
            must.append(
                models.FieldCondition(key="tenant_id", match=models.MatchValue(value=tenant_id))
            )
        if document_id is not None:
            must.append(
                models.FieldCondition(key="document_id", match=models.MatchValue(value=document_id))
            )
        return models.Filter(must=must)

    @staticmethod
    def _require_completed(result: models.UpdateResult) -> None:
        if result.status != models.UpdateStatus.COMPLETED:
            raise IndexWriteError(f"Qdrant operation did not complete: {result.status}")

    @staticmethod
    def _payload(chunk: Chunk) -> dict[str, Any]:
        payload = chunk.model_dump(exclude={"embedding"})
        payload.update(
            chunk_id=chunk.id,
            tenant_id=chunk.metadata.get("tenant_id", "default"),
            filename=chunk.metadata.get("filename", chunk.metadata.get("source", "")),
        )
        return payload

    @staticmethod
    def _chunk(payload: dict[str, Any] | None) -> Chunk:
        if payload is None:
            raise ValueError("Qdrant hit is missing its chunk payload")
        return Chunk.model_validate({**payload, "id": payload["chunk_id"], "embedding": None})

    def upsert_chunks(
        self,
        chunks: list[Chunk],
        vectors: Sequence[Sequence[float]] | np.ndarray,
        *,
        document_counts: Mapping[tuple[str, str], int] | None = None,
    ) -> int:
        """Write complete documents and verify counts per tenant/document.

        Reindex writes resumable batches and supplies cumulative document_counts
        for the prefix already committed. Normal ingestion supplies whole documents.
        """
        if not chunks:
            if len(vectors):
                raise IndexWriteError("Vectors supplied without chunks")
            return 0
        try:
            matrix = np.asarray(vectors, dtype=np.float32)
            if matrix.shape != (len(chunks), self.dim) or not np.isfinite(matrix).all():
                raise ValueError(f"Expected {len(chunks)} finite vectors of dimension {self.dim}")
            counts = Counter(
                (str(c.metadata.get("tenant_id", "default")), c.document_id) for c in chunks
            )
            for start in range(0, len(chunks), 64):
                points = [
                    models.PointStruct(
                        id=point_id(chunk.id), vector=vector.tolist(), payload=self._payload(chunk)
                    )
                    for chunk, vector in zip(
                        chunks[start : start + 64], matrix[start : start + 64], strict=True
                    )
                ]
                result = self.client.upsert(
                    collection_name=self.collection_name, points=points, wait=True
                )
                self._require_completed(result)
            for (tenant, document), expected in counts.items():
                if document_counts is not None:
                    expected = document_counts[(tenant, document)]
                actual = self.count(tenant_id=tenant, document_id=document)
                if actual != expected:
                    raise IndexWriteError(
                        f"Qdrant document {document!r} count mismatch: "
                        f"expected {expected}, found {actual}"
                    )
            return len(chunks)
        except IndexWriteError:
            raise
        except Exception as error:
            raise IndexWriteError(f"Qdrant upsert failed: {error}") from error

    def search(
        self,
        query_vector: Sequence[float] | np.ndarray,
        k: int,
        tenant_id: str,
        filters: Mapping[str, str] | None = None,
    ) -> list[ChunkHit]:
        try:
            vector = np.asarray(query_vector, dtype=np.float32)
            if vector.shape != (self.dim,) or not np.isfinite(vector).all():
                raise ValueError(f"Expected a finite query vector of dimension {self.dim}")
            response = self.client.query_points(
                collection_name=self.collection_name,
                query=vector.tolist(),
                limit=k,
                query_filter=self._filter(tenant_id, filters=filters),
                with_payload=True,
                with_vectors=False,
            )
            return [
                ChunkHit(chunk=self._chunk(hit.payload), score=hit.score) for hit in response.points
            ]
        except Exception as error:
            raise IndexReadError(f"Qdrant search failed: {error}") from error

    def count(self, tenant_id: str | None = None, document_id: str | None = None) -> int:
        try:
            return self.client.count(
                self.collection_name, count_filter=self._filter(tenant_id, document_id), exact=True
            ).count
        except Exception as error:
            raise IndexReadError(f"Qdrant count failed: {error}") from error

    def delete_document(self, document_id: str, tenant_id: str) -> int:
        try:
            before = self.count(tenant_id, document_id)
            result = self.client.delete(
                collection_name=self.collection_name,
                points_selector=self._filter(tenant_id, document_id),
                wait=True,
            )
            self._require_completed(result)
            if self.count(tenant_id, document_id) != 0:
                raise IndexWriteError(f"Qdrant did not delete all chunks of {document_id!r}")
            return before
        except IndexWriteError:
            raise
        except Exception as error:
            raise IndexWriteError(f"Qdrant delete failed: {error}") from error

    def get_all_chunks(self, tenant_id: str | None = None) -> list[Chunk]:
        """Read payloads for existing catalog callers; there is no process cache.

        ``tenant_id=None`` reads every tenant (startup hydration, lexical rebuild).
        """
        chunks: list[Chunk] = []
        offset = None
        try:
            while True:
                records, offset = self.client.scroll(
                    self.collection_name,
                    scroll_filter=self._filter(tenant_id),
                    limit=256,
                    offset=offset,
                    with_payload=True,
                    with_vectors=False,
                )
                chunks.extend(self._chunk(record.payload) for record in records)
                if offset is None:
                    return chunks
        except Exception as error:
            raise IndexReadError(f"Qdrant chunk read failed: {error}") from error

    def clear(self, tenant_id: str | None = "default") -> None:
        """Clear the selected tenant, or the shared collection when tenant is None."""
        try:
            result = self.client.delete(
                self.collection_name, points_selector=self._filter(tenant_id), wait=True
            )
            self._require_completed(result)
            if self.count(tenant_id) != 0:
                raise IndexWriteError("Qdrant clear left chunks behind")
        except IndexWriteError:
            raise
        except Exception as error:
            raise IndexWriteError(f"Qdrant clear failed: {error}") from error

    def health(self, tenant_id: str | None = None) -> dict[str, Any]:
        try:
            collection = self.client.get_collection(self.collection_name)
            self._check_schema(collection)
            return {"status": "ready", "count": self.count(tenant_id), "error": None}
        except Exception as error:  # noqa: BLE001 - readiness reports the actual backend failure
            return {"status": "unavailable", "count": None, "error": str(error)}
