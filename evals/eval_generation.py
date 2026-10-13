"""Run DeepEval generation metrics against the golden RAG dataset.

EVAL_LLM_API_KEY=... uv run python evals/eval_generation.py
"""

import argparse
import asyncio
import json
import os
import statistics
import sys
import tempfile
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals.eval_retrieval import build_engine
from packages.core.settings import get_settings
from services.gateway.client import LiteLLMClient
from services.rag_engine.generation.prompt import build_prompt
from services.rag_engine.generation.sufficiency import has_sufficient_context

DEFAULT_DATASET = Path(__file__).with_name("golden_dataset.json")
INSUFFICIENT_ANSWER = "I don't have enough information in the provided documents to answer that."


def load_dataset(path: Path = DEFAULT_DATASET) -> list[dict[str, Any]]:
    """Load and minimally validate the current golden dataset schema."""
    dataset = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(dataset, list) or not dataset:
        raise ValueError("golden dataset must be a non-empty list")
    required = {"id", "category", "question", "answerable", "expected_doc", "expected_phrases"}
    ids: set[str] = set()
    for case in dataset:
        if not isinstance(case, dict) or not required <= case.keys():
            raise ValueError(f"golden case must include fields: {', '.join(sorted(required))}")
        if not isinstance(case["id"], str) or not case["id"] or case["id"] in ids:
            raise ValueError(f"golden case has a missing or duplicate id: {case.get('id')!r}")
        if not isinstance(case["question"], str) or not case["question"].strip():
            raise ValueError(f"golden case {case['id']} has an empty question")
        if not isinstance(case["answerable"], bool):
            raise TypeError(f"golden case {case['id']} has a non-boolean answerable value")
        if not isinstance(case["expected_phrases"], list):
            raise TypeError(f"golden case {case['id']} expected_phrases must be a list")
        if case["answerable"] and (not case["expected_doc"] or not case["expected_phrases"]):
            raise ValueError(
                f"answerable golden case {case['id']} needs expected_doc and expected_phrases"
            )
        ids.add(case["id"])
    return dataset


async def _generate_cases(
    cases: list[dict[str, Any]],
    retriever: Any,
    *,
    tenant_id: str,
    top_k: int,
    min_dense_score: float,
    provider: str,
    model: str,
    api_key: str,
    base_url: str | None,
) -> list[dict[str, Any]]:
    client = LiteLLMClient()
    rows = []
    for case in cases:
        result = retriever.retrieve(case["question"], top_k=top_k, tenant_id=tenant_id)
        ranked = result.chunks[:top_k]
        context = [item.to_dict() for item in ranked]
        sufficient = has_sufficient_context(
            case["question"], context, min_dense_score=min_dense_score
        )
        if sufficient:
            prompt = build_prompt(case["question"], context)
            response = await client.chat_completion(
                messages=prompt.messages,
                provider=provider,
                model=model,
                api_key=api_key,
                base_url=base_url,
                temperature=0.0,
                max_tokens=600,
            )
            answer = response["choices"][0]["message"]["content"]
        else:
            answer = INSUFFICIENT_ANSWER
        expected = " ".join(case["expected_phrases"]) if case["answerable"] else INSUFFICIENT_ANSWER
        rows.append(
            {
                "id": case["id"],
                "input": case["question"],
                "actual_output": answer,
                "expected_output": expected,
                "retrieval_context": [item.chunk.text for item in ranked],
            }
        )
    await client.close()
    return rows


def evaluate_with_deepeval(
    rows: list[dict[str, Any]], *, api_key: str, model_name: str, base_url: str | None
) -> dict[str, Any]:
    """Score generated rows with the real DeepEval metrics and configured judge."""
    from deepeval.metrics import AnswerRelevancyMetric, ContextualRecallMetric, FaithfulnessMetric
    from deepeval.models import OpenAIModel
    from deepeval.test_case import LLMTestCase

    judge = OpenAIModel(model=model_name, api_key=api_key, base_url=base_url, temperature=0)
    metrics = {
        "faithfulness": FaithfulnessMetric(model=judge, threshold=0.85, async_mode=False),
        "answer_relevancy": AnswerRelevancyMetric(model=judge, async_mode=False),
        "contextual_recall": ContextualRecallMetric(model=judge, async_mode=False),
    }
    results = []
    for row in rows:
        test_case = LLMTestCase(
            input=row["input"],
            actual_output=row["actual_output"],
            expected_output=row["expected_output"],
            retrieval_context=row["retrieval_context"],
        )
        metric_results = {}
        for name, metric in metrics.items():
            metric.measure(test_case)
            metric_results[name] = {"score": metric.score, "reason": metric.reason}
        results.append({"id": row["id"], **metric_results})

    faithfulness_scores = [item["faithfulness"]["score"] for item in results]
    average_faithfulness = statistics.mean(faithfulness_scores) if faithfulness_scores else 0.0
    return {
        "tool": "DeepEval",
        "judge_model": model_name,
        "metrics": {
            "faithfulness_average": average_faithfulness,
            "answer_relevancy_average": statistics.mean(
                item["answer_relevancy"]["score"] for item in results
            )
            if results
            else 0.0,
            "contextual_recall_average": statistics.mean(
                item["contextual_recall"]["score"] for item in results
            )
            if results
            else 0.0,
        },
        "thresholds": {"faithfulness_average": 0.85},
        "gate": "PASS" if average_faithfulness >= 0.85 else "FAIL",
        "cases": [
            {
                **item,
                "input": source["input"],
                "actual_output": source["actual_output"],
                "expected_output": source["expected_output"],
            }
            for item, source in zip(results, rows, strict=True)
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--docs", type=Path, default=Path("sample_docs"))
    parser.add_argument("--report-dir", type=Path, default=Path("evals/reports"))
    parser.add_argument("--provider", default=os.environ.get("EVAL_LLM_PROVIDER", "openai"))
    parser.add_argument("--model", default=os.environ.get("EVAL_LLM_MODEL", "gpt-4o-mini"))
    parser.add_argument("--base-url", default=os.environ.get("EVAL_LLM_BASE_URL"))
    args = parser.parse_args()

    api_key = os.environ.get("EVAL_LLM_API_KEY")
    if not api_key:
        parser.error("EVAL_LLM_API_KEY is required for the manual/nightly DeepEval run")
    cases = load_dataset(args.dataset)
    settings = get_settings()
    with tempfile.TemporaryDirectory(prefix="eval_generation_") as tmp:
        retriever, _store = build_engine(
            args.docs,
            Path(tmp),
            settings.embedding_model,
            settings.fastembed_cache_path,
            tenant_id="generation-eval",
        )
        rows = asyncio.run(
            _generate_cases(
                cases,
                retriever,
                tenant_id="generation-eval",
                top_k=settings.retrieval_default_top_k,
                min_dense_score=settings.min_dense_score,
                provider=args.provider,
                model=args.model,
                api_key=api_key,
                base_url=args.base_url,
            )
        )

    report = evaluate_with_deepeval(
        rows, api_key=api_key, model_name=args.model, base_url=args.base_url
    )
    args.report_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.report_dir / f"{date.today().isoformat()}.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {"report": str(report_path), "gate": report["gate"], "metrics": report["metrics"]},
            indent=2,
        )
    )
    return 0 if report["gate"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
