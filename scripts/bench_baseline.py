"""Performance baseline benchmark harness for Meridian retrieval paths and full queries.

This module measures the production retrieval stages (vector-only, BM25-only,
fusion, and reranked) plus the full agentic query path.  It uses the checked-in
golden dataset and only calls a real LLM provider when one is configured.  All
temporary indexes are isolated from the operator's configured Qdrant collection.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np

from services.ingestion.vector_store import QdrantChunkStore

try:
    from scripts.bench_retrieval import percentile as _bench_percentile
    from scripts.retrieval_check import SUPPORTED_SUFFIXES as _SUPPORTED_SUFFIXES
    from scripts.retrieval_check import build_engine as _retrieval_check_build_engine
except Exception:  # pragma: no cover - fallback for direct script execution
    from bench_retrieval import percentile as _bench_percentile  # type: ignore
    from retrieval_check import SUPPORTED_SUFFIXES as _SUPPORTED_SUFFIXES  # type: ignore
    from retrieval_check import build_engine as _retrieval_check_build_engine  # type: ignore

SUPPORTED_RETRIEVAL_PATHS = ("vector_only", "bm25_only", "fusion", "reranked")
DEFAULT_GOLDEN_DATASET_PATHS = (
    Path("tests/data/golden_queries.json"),
    Path("evals/golden_queries.json"),
    Path("evals/golden_dataset.json"),
)
_PLACEHOLDER_TOKENS = (
    "replace-with",
    "your-model",
    "your-provider",
    "your-api-key",
    "example.com",
    "api.example",
    "changeme",
)


def percentile(samples: list[float], p: int) -> float:
    """Nearest-rank percentile (delegated to the retrieval benchmark helper)."""
    return _bench_percentile(samples, p)


def _is_placeholder(value: Any) -> bool:
    text = str(value or "").strip().lower()
    if not text:
        return True
    return any(token in text for token in _PLACEHOLDER_TOKENS)


def load_golden_dataset(path: str | Path | None = None) -> list[dict[str, Any]]:
    """Load the golden query dataset from an explicit or default location."""
    if path is None:
        for candidate in DEFAULT_GOLDEN_DATASET_PATHS:
            if candidate.exists():
                path = candidate
                break
    if path is None:
        raise FileNotFoundError("no golden dataset found in default locations")
    dataset_path = Path(path)
    data = json.loads(dataset_path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("golden dataset must be a JSON array")
    return data


def resolve_provider_config(
    settings: Any | None = None, environ: dict[str, str] | None = None
) -> dict[str, Any] | None:
    """Return a usable real-provider configuration, or ``None`` when unavailable."""
    env = environ if environ is not None else os.environ

    provider = (env.get("PROVIDER") or env.get("LLM_PROVIDER") or "").strip().lower()

    # Prefer the application's resolved provider configuration when available.
    # When a caller explicitly supplies an environment mapping, use only that
    # mapping so tests and CI can reason about configuration deterministically.
    if environ is None:
        try:
            from services.rag_engine.routers._state import _resolve_active_llm_config_with_secrets

            config = _resolve_active_llm_config_with_secrets()
            if _provider_config_usable(config):
                return dict(config)
        except Exception:
            pass

    provider = (env.get("PROVIDER") or env.get("LLM_PROVIDER") or "").strip().lower()
    model = (env.get("MODEL") or env.get("LLM_MODEL") or "").strip()
    api_key = (env.get("API_KEY") or env.get("LLM_API_KEY") or "").strip()
    base_url = (env.get("BASE_URL") or env.get("LLM_BASE_URL") or "").strip()
    if not provider and (model or api_key or base_url):
        provider = "custom"
    if model and not _is_placeholder(model) and (api_key or provider in {"ollama", "custom"}):
        if base_url and _is_placeholder(base_url):
            pass
        else:
            return {
                "provider": provider or "custom",
                "model": model,
                "api_key": api_key or None,
                "base_url": base_url,
            }

    if settings is not None and environ is None:
        for candidate in ("openai", "anthropic", "openrouter", "deepseek", "groq", "ollama", "custom"):
            key = getattr(settings, f"{candidate}_api_key", None)
            if not key or _is_placeholder(key):
                continue
            configured_model = getattr(settings, "default_model", None)
            model_name = configured_model or getattr(settings, "model", None) or ""
            if not model_name or _is_placeholder(model_name):
                continue
            base = getattr(settings, f"{candidate}_base_url", None) or ""
            if base and _is_placeholder(base):
                continue
            return {
                "provider": candidate,
                "model": model_name,
                "api_key": key,
                "base_url": base or "",
            }

    return None


def _provider_config_usable(config: Any) -> bool:
    if not isinstance(config, dict):
        return False
    model = str(config.get("model") or "").strip()
    if not model or _is_placeholder(model):
        return False
    provider = str(config.get("provider") or "").strip().lower()
    api_key = config.get("api_key")
    base_url = str(config.get("base_url") or "").strip()
    if provider in {"ollama"}:
        return not (base_url and _is_placeholder(base_url))
    if provider in {"custom"}:
        if base_url and _is_placeholder(base_url):
            return False
        return True
    if api_key and not _is_placeholder(api_key):
        if base_url and _is_placeholder(base_url):
            return False
        return True
    return False


def provider_configured(settings: Any | None = None, environ: dict[str, str] | None = None) -> bool:
    """Whether a real provider is configured for full-query benchmarking."""
    return resolve_provider_config(settings=settings, environ=environ) is not None


def build_engine(*args: Any, **kwargs: Any):
    """Compatibility wrapper around the retrieval-check engine builder."""
    return _retrieval_check_build_engine(*args, **kwargs)


def build_golden_engine(
    docs_dir: str | Path | None = None,
    storage_dir: str | Path | None = None,
    model: str | None = None,
    cache_path: str | None = None,
    tenant_id: str = "golden-benchmark",
    embedder: Any | None = None,
) -> tuple[Any, QdrantChunkStore]:
    """Build an isolated retriever over the golden source documents."""
    from packages.core.settings import get_settings
    from services.ingestion.embedder import FastEmbedEmbedder
    from services.ingestion.pipeline import IngestionPipeline
    from services.rag_engine.retrieval.bm25 import BM25Index
    from services.rag_engine.retrieval.hybrid import HybridRetriever

    if docs_dir is None:
        for candidate in (Path("storage/originals"), Path("sample_docs")):
            if candidate.exists():
                docs_dir = candidate
                break
        else:
            docs_dir = Path("storage/originals")
    docs_dir = Path(docs_dir)
    if storage_dir is None:
        storage_dir = Path(tempfile.mkdtemp(prefix="meridian-bench-golden-"))
    else:
        storage_dir = Path(storage_dir)

    if embedder is None:
        if model is None or cache_path is None:
            settings = get_settings()
            model = model or settings.embedding_model
            cache_path = cache_path or settings.fastembed_cache_path
        embedder = FastEmbedEmbedder(model, cache_path=cache_path)

    store = QdrantChunkStore(
        # Local in-memory Qdrant keeps the benchmark isolated and reproducible.
        __import__("qdrant_client").QdrantClient(":memory:"),
        "golden_benchmark",
        embedder.dim,
    )
    store.ensure_collection()
    pipeline = IngestionPipeline(vector_store=store, embedder=embedder, storage_root=storage_dir)

    for path in sorted(docs_dir.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in _SUPPORTED_SUFFIXES:
            continue
        pipeline.ingest_file(path.name, path.read_bytes(), tenant_id=tenant_id)

    retriever = HybridRetriever(
        embedder=embedder,
        vector_store=store,
        bm25_index=BM25Index(store.get_all_chunks(tenant_id)),
    )
    return retriever, store


@contextmanager
def retrieval_path_context(retriever: Any, path: str, reranker: Any | None = None):
    """Temporarily configure ``retriever`` for one retrieval path."""
    if path not in SUPPORTED_RETRIEVAL_PATHS:
        raise ValueError(f"unknown retrieval path: {path}")

    saved = {
        "bm25_index": getattr(retriever, "bm25_index", None),
        "search": retriever.vector_store.search,
        "reranker": getattr(retriever, "reranker", None),
        "embedder": getattr(retriever, "embedder", None),
    }
    try:
        if path == "vector_only":
            from services.rag_engine.retrieval.bm25 import BM25Index

            retriever.bm25_index = BM25Index([])
            retriever.reranker = None
        elif path == "bm25_only":
            retriever.vector_store.search = lambda *args, **kwargs: []
            retriever.reranker = None
            retriever.embedder = _DummyEmbedder()
        elif path == "fusion":
            retriever.reranker = None
        elif path == "reranked":
            if reranker is not None:
                retriever.reranker = reranker
        yield
    finally:
        retriever.bm25_index = saved["bm25_index"]
        retriever.vector_store.search = saved["search"]
        retriever.reranker = saved["reranker"]
        retriever.embedder = saved["embedder"]


class _DummyEmbedder:
    """Embedder stub used when dense search is disabled for BM25-only timing."""

    def embed_query(self, text: str) -> None:
        return None

    def embed_passages(self, texts: list[str]) -> list[list[float]]:
        return [[] for _ in texts]


def measure_retrieval_path(
    retriever: Any,
    path: str,
    query: str,
    *,
    top_k: int = 5,
    tenant_id: str = "default",
    reranker: Any | None = None,
) -> Any:
    """Measure one retrieval path and return the production ``RetrievalResult``."""
    with retrieval_path_context(retriever, path, reranker=reranker):
        return retriever.retrieve(query, top_k=top_k, tenant_id=tenant_id)


def _summarize_timings(samples: list[dict[str, float]]) -> dict[str, dict[str, float]]:
    if not samples:
        return {}
    stages = sorted({stage for sample in samples for stage in sample})
    return {
        stage: {f"p{p}": round(percentile([row[stage] for row in samples], p), 3) for p in (50, 95, 99)}
        for stage in stages
    }


def measure_retrieval_paths(
    retriever: Any,
    cases: list[dict[str, Any]],
    *,
    paths: list[str] | tuple[str, ...] | None = None,
    top_k: int = 5,
    tenant_id: str = "default",
    reranker: Any | None = None,
    reranker_factory: Any | None = None,
) -> dict[str, Any]:
    """Measure every requested retrieval path over golden cases."""
    selected_paths = list(paths or SUPPORTED_RETRIEVAL_PATHS)
    for path in selected_paths:
        if path not in SUPPORTED_RETRIEVAL_PATHS:
            raise ValueError(f"unknown retrieval path: {path}")

    if reranker is None and reranker_factory is not None:
        reranker = reranker_factory()

    retrieval_paths: dict[str, Any] = {}
    for path in selected_paths:
        cases_out: list[dict[str, Any]] = []
        timings: list[dict[str, float]] = []
        started = time.perf_counter()
        for case in cases:
            result = measure_retrieval_path(
                retriever,
                path,
                str(case.get("question", "")),
                top_k=top_k,
                tenant_id=tenant_id,
                reranker=reranker,
            )
            timing = dict(getattr(result, "timings_ms", {}) or {})
            timings.append(timing)
            cases_out.append(
                {
                    "id": case.get("id"),
                    "question": case.get("question"),
                    "chunk_count": len(getattr(result, "chunks", []) or []),
                    "timings_ms": timing,
                }
            )
        wall_seconds = time.perf_counter() - started
        latency_summary = _summarize_timings(timings)
        total_p50 = latency_summary.get("total", {}).get("p50", 0.0)
        total_p95 = latency_summary.get("total", {}).get("p95", 0.0)
        total_p99 = latency_summary.get("total", {}).get("p99", 0.0)
        throughput = len(cases) / wall_seconds if wall_seconds > 0 else 0.0
        path_result = {
            "cases": cases_out,
            "summary": {
                "case_count": len(cases_out),
                "wall_ms": round(wall_seconds * 1000, 3),
                "throughput_qps": round(throughput, 3),
                "latency_ms": latency_summary,
            },
            "case_count": len(cases_out),
            "wall_ms": round(wall_seconds * 1000, 3),
            "throughput_qps": round(throughput, 3),
            "p50_ms": total_p50,
            "p95_ms": total_p95,
            "p99_ms": total_p99,
            "latency_ms": latency_summary,
        }
        retrieval_paths[path] = path_result

    # Convenience aliases for callers/tests that expect a flatter shape.
    result = dict(retrieval_paths)
    result["retrieval_paths"] = retrieval_paths
    result["paths"] = retrieval_paths
    return result


async def measure_full_query(
    retriever: Any,
    cases: list[dict[str, Any]],
    *,
    graph_store: Any | None = None,
    provider_config: dict[str, Any] | None = None,
    top_k: int = 5,
    tenant_id: str = "default",
    max_cycles: int = 2,
    min_dense_score: float | None = None,
    verify_mode: str = "citations",
) -> dict[str, Any]:
    """Measure the full agentic query path using a real provider when configured."""
    if provider_config is None:
        provider_config = resolve_provider_config()
    if provider_config is None:
        return {
            "status": "skipped",
            "reason": "no real provider configured",
            "case_count": len(cases),
            "cases": [],
        }

    from packages.core.settings import get_settings
    from services.ingestion.graph_store import KnowledgeGraphStore
    from services.gateway.client import LiteLLMClient
    from services.rag_engine.agent.graph import build_rag_agent_graph

    if graph_store is None:
        graph_store = KnowledgeGraphStore(in_memory=True)
    if min_dense_score is None:
        min_dense_score = get_settings().min_dense_score

    llm_client = LiteLLMClient()
    try:
        graph = build_rag_agent_graph(
            retriever=retriever,
            graph_store=graph_store,
            llm_client=llm_client,
            llm_config_getter=lambda: provider_config,
            min_dense_score=min_dense_score,
            verify_mode=verify_mode,
        )
        rows: list[dict[str, Any]] = []
        started_all = time.perf_counter()
        for case in cases:
            question = str(case.get("question", ""))
            initial_state = {
                "query": question,
                "current_search_query": question,
                "retrieved_chunks": [],
                "entities": [],
                "draft_answer": "",
                "cycle_count": 0,
                "max_cycles": max_cycles,
                "is_refusal": False,
                "tenant_id": tenant_id,
                "flagged_chunk_ids": [],
                "answer_status": "answered",
                "verification_result": None,
                "timings_ms": {},
                "request_id": None,
                "serving_provider": None,
                "serving_model": None,
                "usage": None,
                "debug": {},
                "session_id": None,
            }
            started = time.perf_counter()
            final_state = await graph.ainvoke(
                initial_state, config={"configurable": {"top_k": top_k}}
            )
            elapsed_ms = (time.perf_counter() - started) * 1000
            timings = dict(final_state.get("timings_ms") or {})
            timings["total"] = elapsed_ms
            rows.append(
                {
                    "id": case.get("id"),
                    "question": question,
                    "answer_status": final_state.get("answer_status"),
                    "verified": bool(final_state.get("verified", False)),
                    "cycle_count": final_state.get("cycle_count", 0),
                    "elapsed_ms": round(elapsed_ms, 3),
                    "timings_ms": timings,
                    "usage": final_state.get("usage"),
                }
            )
        wall_seconds = time.perf_counter() - started_all
        throughput = len(rows) / wall_seconds if wall_seconds > 0 else 0.0
        return {
            "status": "completed",
            "case_count": len(rows),
            "wall_ms": round(wall_seconds * 1000, 3),
            "throughput_qps": round(throughput, 3),
            "cases": rows,
            "latency_ms": _summarize_timings([row["timings_ms"] for row in rows]),
        }
    finally:
        if hasattr(llm_client, "close"):
            await llm_client.close()


def measure_full_query_sync(*args: Any, **kwargs: Any) -> dict[str, Any]:
    """Synchronous wrapper for :func:`measure_full_query`."""
    return asyncio.run(measure_full_query(*args, **kwargs))


measure_full_agentic_query = measure_full_query
measure_agentic_query = measure_full_query


def run_benchmark(
    docs_dir: str | Path | None = None,
    storage_dir: str | Path | None = None,
    golden_path: str | Path | None = None,
    tenant_id: str = "golden-benchmark",
    top_k: int = 5,
    paths: list[str] | tuple[str, ...] | None = None,
    run_full_query: bool = True,
    provider_config: dict[str, Any] | None = None,
    embedder: Any | None = None,
) -> dict[str, Any]:
    """Run the complete baseline benchmark and return a JSON-serializable report."""
    retriever, _store = build_golden_engine(
        docs_dir=docs_dir, storage_dir=storage_dir, tenant_id=tenant_id, embedder=embedder
    )
    cases = load_golden_dataset(golden_path)
    retrieval = measure_retrieval_paths(
        retriever, cases, paths=paths, top_k=top_k, tenant_id=tenant_id
    )
    full_query = None
    if run_full_query:
        full_query = asyncio.run(
            measure_full_query(
                retriever,
                cases,
                tenant_id=tenant_id,
                top_k=top_k,
                provider_config=provider_config,
            )
        )
    return {
        "golden_dataset": str(golden_path or _first_existing_golden_path()),
        "tenant_id": tenant_id,
        "top_k": top_k,
        "paths": retrieval.get("retrieval_paths", retrieval),
        "retrieval_paths": retrieval.get("retrieval_paths", retrieval),
        "full_query": full_query,
    }


def _first_existing_golden_path() -> Path:
    for candidate in DEFAULT_GOLDEN_DATASET_PATHS:
        if candidate.exists():
            return candidate
    return DEFAULT_GOLDEN_DATASET_PATHS[0]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docs", type=Path, default=None)
    parser.add_argument("--storage-dir", type=Path, default=None)
    parser.add_argument("--golden", type=Path, default=None)
    parser.add_argument("--tenant", default="golden-benchmark")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--paths", nargs="*", default=None)
    parser.add_argument("--skip-full-query", action="store_true")
    parser.add_argument("--output", type=Path, default=Path("evals/reports/perf_baseline.json"))
    args = parser.parse_args(argv)

    report = run_benchmark(
        docs_dir=args.docs,
        storage_dir=args.storage_dir,
        golden_path=args.golden,
        tenant_id=args.tenant,
        top_k=args.top_k,
        paths=args.paths,
        run_full_query=not args.skip_full_query,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(args.output), "full_query_status": (report.get("full_query") or {}).get("status")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
