"""Evaluate retrieval quality against ``golden_dataset.json``.

    uv run python evals/eval_retrieval.py
"""

import argparse
import json
import math
import statistics
import sys
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.retrieval_check import build_engine
from services.rag_engine.generation.sufficiency import has_sufficient_context


def _normalize(text: str) -> str:
    return " ".join(text.casefold().split())


def _matches_expected_doc(chunk: Any, expected_doc: str) -> bool:
    filename = getattr(chunk, "filename", "")
    if not filename:
        ranked_chunk = getattr(chunk, "chunk", None)
        metadata = getattr(ranked_chunk, "metadata", {})
        filename = metadata.get("filename") or metadata.get("source", "")
    return Path(str(filename)).name == Path(expected_doc).name


def _phrase_matches(chunk: Any, expected_doc: str, phrases: list[str]) -> set[str]:
    if not _matches_expected_doc(chunk, expected_doc):
        return set()
    text = _normalize(chunk.chunk.text)
    return {phrase for phrase in phrases if _normalize(phrase) in text}


def _hit_at_k(chunks: list[Any], expected_doc: str, phrases: list[str], k: int) -> bool:
    return any(_phrase_matches(chunk, expected_doc, phrases) for chunk in chunks[:k])


def _reciprocal_rank(chunks: list[Any], expected_doc: str, phrases: list[str]) -> float:
    for rank, chunk in enumerate(chunks[:10], start=1):
        if _phrase_matches(chunk, expected_doc, phrases):
            return 1 / rank
    return 0.0


def _recall_at_5(chunks: list[Any], expected_doc: str, phrases: list[str]) -> float:
    if not phrases:
        return 0.0
    found = set()
    for chunk in chunks[:5]:
        found.update(_phrase_matches(chunk, expected_doc, phrases))
    return len(found) / len(phrases)


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return ordered[index]


def _summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    answerable = [row for row in rows if row["answerable"]]
    unanswerable = [row for row in rows if not row["answerable"]]

    def average(key: str) -> float | None:
        return sum(row[key] for row in answerable) / len(answerable) if answerable else None

    correctly_flagged = sum(not row["sufficient"] for row in unanswerable)
    return {
        "cases": len(rows),
        "answerable_cases": len(answerable),
        "unanswerable_cases": len(unanswerable),
        "hit@1": average("hit@1"),
        "hit@3": average("hit@3"),
        "hit@5": average("hit@5"),
        "recall@5": average("recall@5"),
        "mrr": average("reciprocal_rank"),
        "unanswerable_accuracy": (
            correctly_flagged / len(unanswerable) if unanswerable else None
        ),
        "latency_ms": {
            "p50": statistics.median(row["latency_ms"] for row in rows) if rows else None,
            "p95": _percentile([row["latency_ms"] for row in rows], 0.95),
            "p99": _percentile([row["latency_ms"] for row in rows], 0.99),
        },
    }


def evaluate(
    retriever: Any,
    cases: list[dict[str, Any]],
    top_k: int = 5,
    tenant_id: str = "eval",
    min_dense_score: float = 0.70,
) -> dict[str, Any]:
    """Evaluate injected retriever results with production sufficiency logic."""
    if top_k < 1:
        raise ValueError("top_k must be positive")
    retrieve_k = max(top_k, 10)  # Appendix F defines MRR through rank 10.
    rows = []
    by_category: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for case in cases:
        result = retriever.retrieve(case["question"], top_k=retrieve_k, tenant_id=tenant_id)
        ranked = result.chunks
        answerable = case["answerable"]
        phrases = case["expected_phrases"]
        if answerable:
            if not case["expected_doc"] or not phrases:
                raise ValueError(f"answerable case {case['id']} needs expected_doc and expected_phrases")
            hit1 = float(_hit_at_k(ranked, case["expected_doc"], phrases, 1))
            hit3 = float(_hit_at_k(ranked, case["expected_doc"], phrases, 3))
            hit5 = float(_hit_at_k(ranked, case["expected_doc"], phrases, 5))
            recall5 = _recall_at_5(ranked, case["expected_doc"], phrases)
            rr = _reciprocal_rank(ranked, case["expected_doc"], phrases)
        else:
            hit1 = hit3 = hit5 = recall5 = rr = 0.0

        # Use the same check and score shape as the generation sufficiency node.
        sufficient = has_sufficient_context(
            case["question"],
            [chunk.to_dict() for chunk in ranked[:top_k]],
            min_dense_score=min_dense_score,
        )
        row = {
            "id": case["id"],
            "category": case["category"],
            "answerable": answerable,
            "hit@1": hit1,
            "hit@3": hit3,
            "hit@5": hit5,
            "recall@5": recall5,
            "reciprocal_rank": rr,
            "sufficient": sufficient,
            "latency_ms": float(result.timings_ms["total"]),
        }
        rows.append(row)
        by_category[case["category"]].append(row)

    return {
        "metrics": _summarize(rows),
        "categories": {category: _summarize(category_rows) for category, category_rows in sorted(by_category.items())},
        "cases": rows,
    }


def gate_failures(report: dict[str, Any], thresholds: dict[str, float]) -> list[str]:
    metrics = report["metrics"]
    failures = []
    for metric in ("hit@5", "mrr", "unanswerable_accuracy"):
        actual = metrics[metric]
        threshold = thresholds[metric]
        if actual is None:
            failures.append(f"{metric} is undefined")
        elif actual < threshold:
            failures.append(f"{metric} {actual:.3f} < {threshold:.3f}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", default="evals/golden_dataset.json")
    parser.add_argument("--thresholds", default="evals/thresholds.json")
    parser.add_argument("--docs", default="sample_docs")
    parser.add_argument("--top-k", type=int)
    parser.add_argument("--tenant", default="eval")
    args = parser.parse_args()

    from packages.core.settings import get_settings

    cases = json.loads(Path(args.dataset).read_text(encoding="utf-8"))
    thresholds = json.loads(Path(args.thresholds).read_text(encoding="utf-8"))
    settings = get_settings()
    top_k = args.top_k if args.top_k is not None else settings.retrieval_default_top_k
    with tempfile.TemporaryDirectory(prefix="eval_retrieval_") as tmp:
        retriever, _store = build_engine(
            Path(args.docs), Path(tmp), settings.embedding_model, settings.fastembed_cache_path, args.tenant
        )
        report = evaluate(
            retriever,
            cases,
            top_k=top_k,
            tenant_id=args.tenant,
            min_dense_score=settings.min_dense_score,
        )

    failures = gate_failures(report, thresholds)
    report["thresholds"] = thresholds
    report["gate"] = "FAIL" if failures else "PASS"
    report["gate_failures"] = failures
    print(json.dumps(report, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
