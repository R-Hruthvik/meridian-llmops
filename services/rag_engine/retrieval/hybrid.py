"""Hybrid Retriever combining Dense Vector, Sparse BM25, and Cross-Encoder Reranking."""


from packages.core.models import Chunk, SearchResult
from services.ingestion.vector_store import VectorStoreManager
from services.rag_engine.retrieval.bm25 import BM25Index
from services.rag_engine.retrieval.fusion import reciprocal_rank_fusion
from services.rag_engine.retrieval.reranker import CrossEncoderReranker


class HybridRetriever:
    """Fuses Qdrant dense vector search and BM25 sparse lexical search with BGE Reranker."""

    def __init__(
        self,
        vector_store: VectorStoreManager,
        chunks: list[Chunk] | None = None,
        reranker: CrossEncoderReranker | None = None,
    ):
        self.vector_store = vector_store
        self.chunks = chunks or vector_store.get_all_chunks()
        self.chunk_map: dict[str, Chunk] = {c.id: c for c in self.chunks}
        self.bm25_index = BM25Index(self.chunks)
        self.reranker = reranker or CrossEncoderReranker()

    def update_chunks(self, chunks: list[Chunk]):
        self.chunks = chunks
        self.chunk_map = {c.id: c for c in chunks}
        self.bm25_index = BM25Index(chunks)

    def retrieve(self, query: str, top_k: int = 5) -> list[SearchResult]:
        # 1. Dense vector search
        dense_results = self.vector_store.search(query, top_k=top_k * 2)
        dense_ranked = [(r.chunk_id, r.score) for r in dense_results]

        # 2. Sparse BM25 search
        sparse_results = self.bm25_index.search(query, top_k=top_k * 2)
        sparse_ranked = [(r.chunk_id, r.score) for r in sparse_results]

        # 3. Reciprocal Rank Fusion
        fused = reciprocal_rank_fusion([dense_ranked, sparse_ranked], k=60)

        # 4. Fetch candidate chunks
        candidate_chunks: list[Chunk] = []
        for chunk_id, _ in fused[: top_k * 3]:
            if chunk_id in self.chunk_map:
                candidate_chunks.append(self.chunk_map[chunk_id])

        if not candidate_chunks:
            return []

        # 5. Cross-Encoder Reranking
        reranked_results = self.reranker.rerank(query=query, chunks=candidate_chunks, top_k=top_k)
        return reranked_results
