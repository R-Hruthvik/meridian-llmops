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
from services.ingestion.graph_store import KnowledgeGraphStore
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


def evaluate_graph_ab(
    retriever: Any,
    graph_store: KnowledgeGraphStore,
    cases: list[dict[str, Any]],
    top_k: int = 5,
    tenant_id: str = "eval",
) -> dict[str, Any]:
    """Compare retrieved hop-source coverage with provenance-grounded graph paths."""
    if top_k < 1:
        raise ValueError("top_k must be positive")
    rows = []
    chunks_by_source: dict[str, set[str]] = defaultdict(set)
    for chunk in retriever.bm25_index.chunks:
        source = chunk.metadata.get("filename") or chunk.metadata.get("source")
        if source:
            chunks_by_source[Path(str(source)).name].add(chunk.id)

    def expected_chunk_ids(hop: dict[str, Any]) -> set[str]:
        if "chunk_id" in hop:
            return {hop["chunk_id"]}
        return chunks_by_source.get(Path(hop["source_doc"]).name, set())

    for case in cases:
        hops = case.get("expected_hops", [])
        if not hops:
            continue
        ranked = retriever.retrieve(case["question"], top_k=top_k, tenant_id=tenant_id).chunks[:top_k]
        retrieved_ids = {item.chunk.id for item in ranked}
        hop_chunk_ids = [expected_chunk_ids(hop) for hop in hops]
        baseline_hops = sum(bool(source_ids & retrieved_ids) for source_ids in hop_chunk_ids)
        graph_hops = 0
        for hop, source_ids in zip(hops, hop_chunk_ids, strict=True):
            found = any(
                relation.source_entity == hop["source_entity"]
                and relation.relation_type == hop["relation_type"]
                and relation.target_entity == hop["target_entity"]
                and bool(source_ids & set(relation.chunk_ids))
                for relation in graph_store.query_neighborhood(hop["source_entity"], tenant_id=tenant_id)
            )
            graph_hops += int(found and bool(source_ids & retrieved_ids))
        rows.append({
            "id": case["id"],
            "hops": len(hops),
            "baseline_hop_recall": baseline_hops / len(hops),
            "graph_grounded_hop_recall": graph_hops / len(hops),
            "baseline_complete_path": baseline_hops == len(hops),
            "graph_complete_path": graph_hops == len(hops),
        })

    case_count = len(rows)
    if not case_count:
        raise ValueError("graph evaluation requires cases with expected_hops")
    total_hops = sum(row["hops"] for row in rows)
    baseline_found = sum(row["baseline_hop_recall"] * row["hops"] for row in rows)
    graph_found = sum(row["graph_grounded_hop_recall"] * row["hops"] for row in rows)
    baseline_complete = sum(row["baseline_complete_path"] for row in rows)
    graph_complete = sum(row["graph_complete_path"] for row in rows)
    baseline_recall = baseline_found / total_hops
    graph_recall = graph_found / total_hops
    baseline_path_rate = baseline_complete / case_count
    graph_path_rate = graph_complete / case_count
    return {
        "scope": "multi-hop retrieval evidence coverage; generated answer quality is not measured",
        "cases": case_count,
        "baseline": {
            "hop_recall": baseline_recall,
            "complete_path_rate": baseline_path_rate,
        },
        "graph_enabled": {
            "grounded_hop_recall": graph_recall,
            "complete_path_rate": graph_path_rate,
        },
        "delta": {
            "hop_recall": graph_recall - baseline_recall,
            "complete_path_rate": graph_path_rate - baseline_path_rate,
        },
        "case_results": rows,
    }


def _index_graph(retriever: Any, tenant_id: str) -> KnowledgeGraphStore:
    graph_store = KnowledgeGraphStore(in_memory=True)
    chunks_by_document: dict[str, list[Any]] = defaultdict(list)
    for chunk in retriever.bm25_index.chunks:
        chunks_by_document[chunk.document_id].append(chunk)
    for document_id, chunks in chunks_by_document.items():
        graph_store.extract_and_store(
            document_id,
            "\n".join(chunk.text for chunk in chunks),
            tenant_id=tenant_id,
            chunks=chunks,
        )
    return graph_store


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
    parser.add_argument("--dataset")
    parser.add_argument("--thresholds", default="evals/thresholds.json")
    parser.add_argument("--docs")
    parser.add_argument("--top-k", type=int)
    parser.add_argument("--tenant", default="eval")
    parser.add_argument("--graph", action="store_true", help="Run the multi-hop graph A/B evidence comparison")
    args = parser.parse_args()

    from packages.core.settings import get_settings

    dataset_path = args.dataset or ("evals/graph_golden_dataset.json" if args.graph else "evals/golden_dataset.json")
    docs_path = args.docs or ("evals/graph_corpus" if args.graph else "sample_docs")
    cases = json.loads(Path(dataset_path).read_text(encoding="utf-8"))
    thresholds = json.loads(Path(args.thresholds).read_text(encoding="utf-8"))
    settings = get_settings()
    top_k = args.top_k if args.top_k is not None else settings.retrieval_default_top_k
    with tempfile.TemporaryDirectory(prefix="eval_retrieval_") as tmp:
        retriever, _store = build_engine(
            Path(docs_path), Path(tmp), settings.embedding_model, settings.fastembed_cache_path, args.tenant
        )
        report = evaluate(
            retriever,
            cases,
            top_k=top_k,
            tenant_id=args.tenant,
            min_dense_score=settings.min_dense_score,
        )
        if args.graph:
            report["graph_ab"] = evaluate_graph_ab(
                retriever,
                _index_graph(retriever, args.tenant),
                [case for case in cases if case.get("expected_hops")],
                top_k=top_k,
                tenant_id=args.tenant,
            )

    report["thresholds"] = thresholds
    if args.graph:
        report["gate"] = "NOT_APPLICABLE"
        report["gate_note"] = "The multi-hop graph set measures evidence coverage, not answer quality gates."
        failures = []
    else:
        failures = gate_failures(report, thresholds)
        report["gate"] = "FAIL" if failures else "PASS"
    report["gate_failures"] = failures
    print(json.dumps(report, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
