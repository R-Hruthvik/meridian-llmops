"""Benchmark hybrid retrieval on an isolated synthetic corpus.

The benchmark creates 500 synthetic documents with 10 concrete chunk records
each, stores vectors in a temporary Qdrant collection, and measures the
production ``HybridRetriever`` stage timings. By default it uses a temporary
local Qdrant index; ``--qdrant-url`` uses a UUID-named temporary server
collection and removes it after the run. The FastEmbed cache is temporary.

    python scripts/bench_retrieval.py
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
import time
import uuid
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from qdrant_client import QdrantClient

from packages.core.models import Chunk
from services.ingestion.embedder import FastEmbedEmbedder
from services.ingestion.vector_store import QdrantChunkStore
from services.rag_engine.retrieval.bm25 import BM25Index
from services.rag_engine.retrieval.hybrid import HybridRetriever

DOCS = 500
CHUNKS_PER_DOC = 10
QUERY_COUNT = 200
WARMUP_COUNT = 10
CONCURRENCY = 8
TIMING_STAGES = ("embed", "dense", "bm25", "fusion", "retrieval", "total")
REPORT_STAGES = (*TIMING_STAGES, "serialization")


def validate_corpus_shape(doc_count: int, chunks_per_doc: int) -> None:
    """Reject inputs that would run below the planned corpus size."""
    if doc_count < 500:
        raise ValueError("benchmark requires at least 500 documents")
    if chunks_per_doc < 1 or doc_count * chunks_per_doc < 5_000:
        raise ValueError("benchmark requires at least 5,000 chunks")


def percentile(samples: Sequence[float], p: int) -> float:
    """Return the nearest-rank percentile for a non-empty latency sample."""
    if not samples:
        raise ValueError("percentile requires at least one sample")
    if not 1 <= p <= 100:
        raise ValueError("percentile must be between 1 and 100")
    ordered = sorted(samples)
    return ordered[math.ceil(p * len(ordered) / 100) - 1]


def summarize(samples: list[dict[str, float]]) -> dict[str, dict[str, float]]:
    """Summarize HybridRetriever timings by stage and percentile."""
    return {
        stage: {
            f"p{p}": round(percentile([row[stage] for row in samples], p), 3)
            for p in (50, 95, 99)
        }
        for stage in REPORT_STAGES
    }


def make_corpus(doc_count: int, chunks_per_doc: int, tenant: str) -> list[Chunk]:
    """Create production-shaped chunk records with stable, diverse lexical text."""
    chunks: list[Chunk] = []
    for doc_number in range(doc_count):
        document_id = f"bench-doc-{doc_number:04d}"
        for chunk_number in range(chunks_per_doc):
            topic = (doc_number * 17 + chunk_number * 31) % 997
            body = (
                f"Synthetic benchmark document {doc_number} section {chunk_number} describes "
                f"retrieval topic {topic}, storage policy {topic % 43}, and service code "
                f"MER-{doc_number:04d}-{chunk_number:02d}. This passage explains local indexing, "
                "semantic search, lexical ranking, payload filtering, and measured response time."
            )
            chunks.append(
                Chunk(
                    id=f"{document_id}-c{chunk_number:04d}",
                    document_id=document_id,
                    text=body,
                    chunk_index=chunk_number,
                    section_heading=f"Section {chunk_number}",
                    metadata={
                        "tenant_id": tenant,
                        "filename": f"document-{doc_number:04d}.md",
                        "title": f"Synthetic document {doc_number}",
                        "source_format": "md",
                    },
                )
            )
    return chunks


def make_queries(count: int, doc_count: int, chunks_per_doc: int) -> list[str]:
    """Generate repeatable lookups that exercise both semantic and lexical search."""
    return [
        f"What does MER-{index % doc_count:04d}-{index % chunks_per_doc:02d} say about "
        f"retrieval topic {(index * 17 + (index % chunks_per_doc) * 31) % 997}?"
        for index in range(count)
    ]


def measure(retriever: HybridRetriever, queries: list[str], tenant: str, workers: int) -> list[dict[str, float]]:
    def retrieve_and_serialize(query: str) -> dict[str, float]:
        result = retriever.retrieve(query, tenant_id=tenant)
        timings = dict(result.timings_ms)
        timings["retrieval"] = timings["total"] - timings["embed"]
        started = time.perf_counter()
        json.dumps([chunk.to_dict() for chunk in result.chunks])
        timings["serialization"] = (time.perf_counter() - started) * 1000
        return timings

    if workers == 1:
        return [retrieve_and_serialize(query) for query in queries]
    with ThreadPoolExecutor(max_workers=workers) as executor:
        return list(executor.map(retrieve_and_serialize, queries))


def profile_dense_payload(store: QdrantChunkStore, query_vectors: list[list[float]], tenant: str) -> dict[str, dict[str, float]]:
    """Compare Qdrant's full-payload query with ID/score-only diagnostic calls."""
    samples = {"raw_full_payload": [], "raw_no_payload": [], "payload_to_chunk": []}
    query_filter = store._filter(tenant)
    for vector in query_vectors:
        started = time.perf_counter()
        full = store.client.query_points(
            collection_name=store.collection_name,
            query=vector,
            limit=20,
            query_filter=query_filter,
            with_payload=True,
            with_vectors=False,
        )
        samples["raw_full_payload"].append((time.perf_counter() - started) * 1000)

        started = time.perf_counter()
        store.client.query_points(
            collection_name=store.collection_name,
            query=vector,
            limit=20,
            query_filter=query_filter,
            with_payload=False,
            with_vectors=False,
        )
        samples["raw_no_payload"].append((time.perf_counter() - started) * 1000)

        started = time.perf_counter()
        [store._chunk(point.payload) for point in full.points]
        samples["payload_to_chunk"].append((time.perf_counter() - started) * 1000)

    return {
        stage: {f"p{p}": round(percentile(values, p), 3) for p in (50, 95, 99)}
        for stage, values in samples.items()
    }


def run(args: argparse.Namespace) -> dict:
    validate_corpus_shape(args.docs, args.chunks_per_doc)
    tenant = "retrieval-benchmark"
    with tempfile.TemporaryDirectory(prefix="meridian-bench-retrieval-") as temporary:
        root = Path(temporary)
        model_cache = root / "fastembed-cache"
        embedder = FastEmbedEmbedder(args.model, cache_path=model_cache)
        client = (
            QdrantClient(url=args.qdrant_url)
            if args.qdrant_url
            else QdrantClient(path=str(root / "qdrant"))
        )
        collection_name = f"bench_{uuid.uuid4().hex}" if args.qdrant_url else "bench_chunks"
        if args.qdrant_url:
            print(f"Using temporary Qdrant collection {collection_name}", file=sys.stderr, flush=True)
        store = QdrantChunkStore(client, collection_name, embedder.dim)
        try:
            store.ensure_collection()

            chunks = make_corpus(args.docs, args.chunks_per_doc, tenant)
            # Keep full documents in each upsert: the store verifies counts per
            # tenant/document after every call. Ten chunks per document divides 200.
            index_batch_size = 200
            for offset in range(0, len(chunks), index_batch_size):
                batch = chunks[offset : offset + index_batch_size]
                vectors = embedder.embed_passages([f"{chunk.metadata['title']} > {chunk.section_heading}\n{chunk.text}" for chunk in batch])
                store.upsert_chunks(batch, vectors)
                indexed = min(offset + len(batch), len(chunks))
                print(f"Indexed {indexed:,}/{len(chunks):,} synthetic chunks", file=sys.stderr, flush=True)

            retriever = HybridRetriever(embedder, store, BM25Index(chunks))
            queries = make_queries(QUERY_COUNT, args.docs, args.chunks_per_doc)
            reports = {}
            for label, workers in (("single_thread", 1), ("4_concurrent", 4), ("8_concurrent", CONCURRENCY)):
                # Warm each execution mode independently so concurrent measurements
                # do not include the first concurrent embedder/Qdrant calls.
                measure(retriever, queries[:WARMUP_COUNT], tenant, workers)
                samples = measure(retriever, queries, tenant, workers)
                reports[label] = summarize(samples)
            diagnostic_vectors = [embedder.embed_query(query).tolist() for query in queries]
            dense_payload_diagnostic = profile_dense_payload(store, diagnostic_vectors, tenant)
            point_count = store.count(tenant_id=tenant)
            if point_count != len(chunks):
                raise RuntimeError(f"temporary Qdrant count mismatch: expected {len(chunks)}, got {point_count}")
            return {
                "model": args.model,
                "qdrant_url": args.qdrant_url or "local",
                "documents": args.docs,
                "chunks": len(chunks),
                "queries_per_mode": QUERY_COUNT,
                "warmup_queries": WARMUP_COUNT,
                "concurrency": CONCURRENCY,
                "timings_ms": reports,
                "dense_payload_diagnostic_ms": dense_payload_diagnostic,
            }
        finally:
            try:
                if args.qdrant_url and client.collection_exists(collection_name):
                    client.delete_collection(collection_name)
            finally:
                client.close()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docs", type=int, default=DOCS)
    parser.add_argument("--chunks-per-doc", type=int, default=CHUNKS_PER_DOC)
    parser.add_argument("--model", default="BAAI/bge-small-en-v1.5")
    parser.add_argument("--qdrant-url", help="Benchmark against this Qdrant server using a temporary collection")
    args = parser.parse_args(argv)
    try:
        result = run(args)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
