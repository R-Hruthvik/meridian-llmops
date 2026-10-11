"""Retrieval quality harness: ingest a corpus, then measure hit@k / MRR / latency.

Self-contained: builds an isolated local Qdrant store and temp storage so the
run never touches the operator's real index.

    python scripts/retrieval_check.py --questions evals/retrieval_smoke.json --top-k 5
    python scripts/retrieval_check.py --questions evals/retrieval_smoke.json --docs sample_docs
"""

import argparse
import json
import statistics
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from qdrant_client import QdrantClient

from services.ingestion.embedder import FastEmbedEmbedder
from services.ingestion.pipeline import IngestionPipeline
from services.ingestion.vector_store import QdrantChunkStore
from services.rag_engine.retrieval.bm25 import BM25Index
from services.rag_engine.retrieval.hybrid import HybridRetriever

DEFAULT_TENANT = 'eval'
SUPPORTED_SUFFIXES = {'.md', '.markdown', '.txt', '.pdf', '.docx', '.html', '.htm'}


def _normalize(text: str) -> str:
    return ' '.join(text.lower().split())


def hit_at_k(chunks: list, expected_doc: str, expected_phrases: list[str], k: int) -> bool:
    """One hit when any top-k chunk comes from expected_doc and contains a phrase."""
    wanted = [_normalize(phrase) for phrase in expected_phrases]
    for chunk in chunks[:k]:
        if expected_doc not in chunk.filename and expected_doc not in chunk.chunk.metadata.get('source', ''):
            continue
        text = _normalize(chunk.chunk.text)
        if any(phrase in text for phrase in wanted):
            return True
    return False


def reciprocal_rank(chunks: list, expected_doc: str, expected_phrases: list[str], cutoff: int = 10) -> float:
    """1/rank of the first qualifying chunk within `cutoff`, else 0."""
    wanted = [_normalize(phrase) for phrase in expected_phrases]
    for position, chunk in enumerate(chunks[:cutoff], start=1):
        if expected_doc not in chunk.filename and expected_doc not in chunk.chunk.metadata.get('source', ''):
            continue
        text = _normalize(chunk.chunk.text)
        if any(phrase in text for phrase in wanted):
            return 1.0 / position
    return 0.0


def build_engine(
    docs_dir: Path,
    storage_dir: Path,
    settings_model: str,
    cache_path: str,
    tenant_id: str = DEFAULT_TENANT,
):
    embedder = FastEmbedEmbedder(settings_model, cache_path=cache_path)
    store = QdrantChunkStore(QdrantClient(':memory:'), 'retrieval_check', embedder.dim)
    store.ensure_collection()
    pipeline = IngestionPipeline(vector_store=store, embedder=embedder, storage_root=storage_dir)
    for path in sorted(docs_dir.glob('*')):
        if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES:
            pipeline.ingest_file(path.name, path.read_bytes(), tenant_id=tenant_id)
    retriever = HybridRetriever(
        embedder=embedder, vector_store=store, bm25_index=BM25Index(store.get_all_chunks(tenant_id))
    )
    return retriever, store


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--questions', default='evals/retrieval_smoke.json')
    parser.add_argument('--docs', default='sample_docs')
    parser.add_argument('--top-k', type=int, default=5)
    parser.add_argument('--tenant', default=DEFAULT_TENANT)
    args = parser.parse_args()

    from packages.core.settings import get_settings

    settings = get_settings()
    with tempfile.TemporaryDirectory(prefix='retrieval_check_') as tmp:
        retriever, store = build_engine(
            Path(args.docs), Path(tmp), settings.embedding_model, settings.fastembed_cache_path, args.tenant
        )
        cases = json.loads(Path(args.questions).read_text(encoding='utf-8'))['cases']

        hits = 0
        rr_total = 0.0
        unanswerable_total = 0
        unanswerable_flagged = 0
        latencies: list[float] = []
        answerable = 0
        for case in cases:
            if not case.get('answerable', True):
                continue
            answerable += 1
            result = retriever.retrieve(case['question'], top_k=args.top_k, tenant_id=args.tenant)
            latencies.append(result.timings_ms['total'])
            hit = hit_at_k(result.chunks, case['expected_doc'], case['expected_phrases'], args.top_k)
            rr = reciprocal_rank(result.chunks, case['expected_doc'], case['expected_phrases'])
            hits += int(hit)
            rr_total += rr
            status = 'PASS' if hit else 'FAIL'
            print(f"[{status}] {case['id']}: {case['question']}")
            for chunk in result.chunks[: args.top_k]:
                scores = chunk.scores
                print(
                    f"    #{chunk.rank} {chunk.filename or chunk.chunk.metadata.get('source', '')} "
                    f"dense={scores.get('dense')} bm25={scores.get('bm25')} rrf={scores.get('rrf'):.4f}"
                )
                print(f"       {chunk.chunk.text[:120]!r}")

        for case in cases:
            if case.get('answerable', True):
                continue
            unanswerable_total += 1
            result = retriever.retrieve(case['question'], top_k=args.top_k, tenant_id=args.tenant)
            dense = [c.scores.get('dense') for c in result.chunks if c.scores.get('dense') is not None]
            best = max(dense) if dense else 0.0
            flagged = best < 0.35
            unanswerable_flagged += int(flagged)
            print(f"[{'PASS' if flagged else 'FAIL'}] {case['id']} (unanswerable, best dense {best:.3f}): {case['question']}")

        if answerable:
            print(f"\nhit@{args.top_k} = {hits / answerable:.3f} ({hits}/{answerable})")
            print(f"MRR      = {rr_total / answerable:.3f}")
        if latencies:
            print(f"latency p50 = {statistics.median(latencies):.1f} ms, p95 = "
                  f"{sorted(latencies)[max(0, int(0.95 * len(latencies)) - 1)]:.1f} ms")
        if unanswerable_total:
            print(f"unanswerable flagged = {unanswerable_flagged / unanswerable_total:.3f} "
                  f"({unanswerable_flagged}/{unanswerable_total})")
        print(f"indexed points: {store.count(tenant_id=args.tenant)}")

    gate = answerable > 0 and hits / answerable >= 0.90 and rr_total / answerable >= 0.70
    print("GATE:", "PASS" if gate else "FAIL")
    return 0 if gate else 1


if __name__ == '__main__':
    raise SystemExit(main())
