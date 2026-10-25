"""Compare retrieval rerankers on the checked-in retrieval smoke set.

    uv run python scripts/eval_retrieval.py --reranker all
"""

import argparse
import json
import math
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from packages.core.settings import get_settings
from scripts.retrieval_check import build_engine, hit_at_k, reciprocal_rank
from services.rag_engine.retrieval.reranker import CrossEncoderReranker, LexicalReranker


def evaluate(retriever, cases: list[dict], top_k: int, min_dense_score: float = 0.60) -> tuple[float, float, float]:
    answerable = [case for case in cases if case.get("answerable", True)]
    hits = 0
    reciprocal_ranks = 0.0
    latencies = []
    for case in answerable:
        result = retriever.retrieve(case["question"], top_k=top_k, tenant_id="eval")
        hits += hit_at_k(result.chunks, case["expected_doc"], case["expected_phrases"], top_k)
        reciprocal_ranks += reciprocal_rank(result.chunks, case["expected_doc"], case["expected_phrases"])
        latencies.append(result.timings_ms["total"])
    p95 = sorted(latencies)[max(0, math.ceil(0.95 * len(latencies)) - 1)]
    return hits / len(answerable), reciprocal_ranks / len(answerable), p95


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reranker", choices=("none", "lexical", "cross_encoder", "all"), default="all")
    parser.add_argument("--top-k", type=int, default=5)
    args = parser.parse_args()

    settings = get_settings()
    cases = json.loads(Path("evals/retrieval_smoke.json").read_text(encoding="utf-8"))["cases"]
    with tempfile.TemporaryDirectory(prefix="eval_retrieval_") as tmp:
        retriever, _store = build_engine(
            Path("sample_docs"), Path(tmp), settings.embedding_model, settings.fastembed_cache_path
        )
        modes = ("none", "lexical", "cross_encoder") if args.reranker == "all" else (args.reranker,)
        print(f"reranker       hit@{args.top_k}     MRR     p95_ms")
        print("-------------- ------- ------- --------")
        for mode in modes:
            if mode == "none":
                retriever.reranker = None
            elif mode == "lexical":
                retriever.reranker = LexicalReranker()
            else:
                retriever.reranker = CrossEncoderReranker(
                    settings.reranker_model, settings.fastembed_cache_path
                )
                # Exclude one-time model execution warmup from request latency.
                retriever.retrieve(cases[0]["question"], top_k=args.top_k, tenant_id="eval")
            hit, mrr, p95 = evaluate(retriever, cases, args.top_k)
            print(f"{mode:<14} {hit:>7.3f} {mrr:>7.3f} {p95:>8.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
