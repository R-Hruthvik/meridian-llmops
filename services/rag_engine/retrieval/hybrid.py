"""Hybrid retriever: dense Qdrant search plus disk-backed BM25, fused with RRF.

Dense hits are materialized from Qdrant payloads; BM25-only hits are
materialized from the disk-record chunks the BM25 index was built from. A
chunk is never dropped because it is missing from some local vector cache,
and any Qdrant failure raises instead of silently degrading.
"""

import threading
import time
from dataclasses import dataclass, field
from typing import Any

from packages.core.models import Chunk
from services.ingestion.embedder import Embedder
from services.ingestion.vector_store import QdrantChunkStore
from services.rag_engine.retrieval.bm25 import BM25Index
from services.rag_engine.retrieval.fusion import reciprocal_rank_fusion

# Multiplier applied to the final score of chunks a reviewer rejected or corrected
# (issue #67). They keep their content but lose ranking authority.
FLAGGED_CHUNK_PENALTY = 0.5


@dataclass(frozen=True)
class RankedChunk:
    """A retrieved chunk with its final rank and per-stage score breakdown."""

    chunk: Chunk
    rank: int
    scores: dict[str, Any] = field(default_factory=dict)

    @property
    def score(self) -> float:
        return float(self.scores.get("final") or 0.0)

    @property
    def chunk_id(self) -> str:
        return self.chunk.id

    @property
    def filename(self) -> str:
        return self.chunk.metadata.get("filename") or self.chunk.metadata.get("source") or ""

    @property
    def page_start(self) -> int | None:
        page = self.chunk.metadata.get("page_start")
        return page if page is not None else self.chunk.metadata.get("page")

    @property
    def heading_path(self) -> str:
        return self.chunk.section_heading or ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "rank": self.rank,
            "chunk_id": self.chunk.id,
            "document_id": self.chunk.document_id,
            "filename": self.filename,
            "title": self.chunk.metadata.get("title", ""),
            "page_start": self.page_start,
            "heading_path": self.heading_path,
            "text": self.chunk.text,
            "scores": self.scores,
        }


@dataclass(frozen=True)
class RetrievalResult:
    """Ranked chunks plus per-stage timings; `chunks` is already cut to top_k."""

    query: str
    top_k: int
    chunks: list[RankedChunk] = field(default_factory=list)
    timings_ms: dict[str, float] = field(default_factory=dict)


class HybridRetriever:
    """Fuses dense vector search and BM25 sparse search with reciprocal rank fusion."""

    def __init__(
        self,
        embedder: Embedder | None,
        vector_store: QdrantChunkStore,
        bm25_index: BM25Index | None = None,
        rrf_k: int = 60,
        pool_min: int = 20,
        reranker: Any | None = None,
        tracer: Any | None = None,
    ):
        self.embedder = embedder
        self.vector_store = vector_store
        self.bm25_index = bm25_index if bm25_index is not None else BM25Index()
        self.rrf_k = rrf_k
        self.pool_min = pool_min
        self.reranker = reranker
        self.tracer = tracer
        self._bm25_lock = threading.Lock()
        self._embed_lock = threading.Semaphore(2)
        self._session_chunks: dict[str, list[str]] = {}  # session_id -> list of chunk_ids seen
        self._session_lock = threading.Lock()

    def update_chunks(self, chunks: list[Chunk]) -> None:
        """Rebuild the lexical corpus from the caller's chunk records.

        Ingestion keeps disk records authoritative, so a full rebuild is the
        correct and simple behavior for a hundreds-of-docs corpus.
        """
        with self._bm25_lock:
            self.bm25_index = BM25Index(chunks)

    def record_session_chunks(self, session_id: str, chunk_ids: list[str]) -> None:
        """Record chunks seen in a session for grouping bias."""
        if not session_id:
            return
        with self._session_lock:
            existing = self._session_chunks.setdefault(session_id, [])
            for cid in chunk_ids:
                if cid not in existing:
                    existing.append(cid)

    def session_chunks(self, session_id: str) -> list[str]:
        """Return chunks seen in a session."""
        if not session_id:
            return []
        with self._session_lock:
            return list(self._session_chunks.get(session_id, []))

    def remove_chunks(self, chunk_ids: list[str]) -> None:
        """Evict chunks from the lexical index when their documents are deleted."""
        with self._bm25_lock:
            self.bm25_index.remove_chunks(chunk_ids)

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        tenant_id: str = "default",
        debug: bool = False,
        flagged_chunk_ids: set[str] | None = None,
        session_id: str | None = None,
    ) -> RetrievalResult:
        pool = max(self.pool_min, 4 * top_k)
        timings: dict[str, float] = {
            name: 0.0 for name in ("embed", "dense", "bm25", "fusion", "rerank")
        }
        started = time.perf_counter()

        stage = time.perf_counter()
        if self.embedder is None:
            raise RuntimeError("Embedder must be initialized at startup or explicitly injected")
        with self._embed_lock, self._span("embed_query", tenant_id=tenant_id):
            query_vector = self.embedder.embed_query(query)
        timings["embed"] = _ms(stage)

        stage = time.perf_counter()
        with self._span("dense_search", tenant_id=tenant_id):
            dense_hits = self.vector_store.search(query_vector, k=pool, tenant_id=tenant_id)
        timings["dense"] = _ms(stage)

        stage = time.perf_counter()
        with self._bm25_lock:
            bm25_index = self.bm25_index
        with self._span("bm25_search", tenant_id=tenant_id):
            sparse_results = bm25_index.search(query, top_k=pool, tenant_id=tenant_id)
        timings["bm25"] = _ms(stage)

        stage = time.perf_counter()
        with self._span("fusion", tenant_id=tenant_id):
            fused = reciprocal_rank_fusion(
                [(hit.chunk.id, hit.score) for hit in dense_hits],
                [(result.chunk_id, result.score) for result in sparse_results],
                k=self.rrf_k,
            )
        timings["fusion"] = _ms(stage)

        dense_by_id = {hit.chunk.id: hit for hit in dense_hits}
        candidates: list[tuple[Chunk, dict[str, Any]]] = []
        for candidate in fused:
            chunk: Chunk | None = None
            dense_hit = dense_by_id.get(candidate.chunk_id)
            if dense_hit is not None:
                chunk = dense_hit.chunk
            else:
                # BM25-only hit: materialize from the disk-record corpus.
                chunk = bm25_index.chunk_of(candidate.chunk_id)
            if chunk is None:
                continue
            if str(chunk.metadata.get("tenant_id", "default")) != tenant_id:
                continue
            # Stable score shape: every stage reports a value or None, so the
            # debug view can show which stages ranked each candidate.
            scores: dict[str, Any] = {
                "dense": candidate.scores.get("dense"),
                "bm25": candidate.scores.get("bm25"),
                "dense_rank": candidate.ranks.get("dense"),
                "bm25_rank": candidate.ranks.get("bm25"),
                "rrf": candidate.rrf,
                "rerank": None,
                "review_penalty": 1.0,
                "final": candidate.rrf,
            }
            candidates.append((chunk, scores))

        if self.reranker is not None and candidates:
            stage = time.perf_counter()
            rerank_candidates = candidates[: max(20, 2 * top_k)]
            with self._span("rerank", tenant_id=tenant_id):
                reranked = self.reranker.rerank(
                    query=query,
                    chunks=[chunk for chunk, _ in rerank_candidates],
                    top_k=max(top_k, 1),
                )
            timings["rerank"] = _ms(stage)
            by_id = {result.chunk_id: result.score for result in reranked}
            candidates = [
                (chunk, {**scores, "rerank": by_id[chunk.id], "final": by_id[chunk.id]})
                for chunk, scores in candidates
                if chunk.id in by_id
            ]
            candidates.sort(key=lambda item: item[1]["final"], reverse=True)

        if flagged_chunk_ids:
            candidates = [
                (chunk, self._penalize(scores) if chunk.id in flagged_chunk_ids else scores)
                for chunk, scores in candidates
            ]
            candidates.sort(key=lambda item: item[1]["final"], reverse=True)

        # Session-aware grouping bias: boost chunks from same session
        if session_id:
            seen_session = set(self.session_chunks(session_id))
            if seen_session:
                candidates = [
                    (
                        chunk,
                        {
                            **scores,
                            "session_boost": 0.1 if chunk.id in seen_session else 0.0,
                            "final": scores["final"] + (0.01 if chunk.id in seen_session else 0.0),
                        },
                    )
                    for chunk, scores in candidates
                ]
                candidates.sort(key=lambda item: item[1]["final"], reverse=True)

        chunks = [
            RankedChunk(chunk=chunk, rank=position, scores=scores)
            for position, (chunk, scores) in enumerate(candidates[:top_k], start=1)
        ]
        # Record session chunks for grouping bias
        if session_id and chunks:
            self.record_session_chunks(session_id, [c.chunk_id for c in chunks])
        timings["total"] = _ms(started)
        return RetrievalResult(query=query, top_k=top_k, chunks=chunks, timings_ms=timings)

    @staticmethod
    def _penalize(scores: dict[str, Any]) -> dict[str, Any]:
        """Reduce a flagged chunk's score without promoting negative logits."""
        final = float(scores["final"] or 0.0)
        return {
            **scores,
            "review_penalty": FLAGGED_CHUNK_PENALTY,
            "final": final - abs(final) * (1 - FLAGGED_CHUNK_PENALTY),
        }

    def _span(self, name: str, **attributes: Any):
        if self.tracer is None:
            from contextlib import nullcontext

            return nullcontext()
        return self.tracer.span(name, **attributes)


def _ms(started: float) -> float:
    return (time.perf_counter() - started) * 1000
