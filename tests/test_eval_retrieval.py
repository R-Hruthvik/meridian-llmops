import json
from pathlib import Path

from evals.eval_retrieval import evaluate, gate_failures
from packages.core.models import Chunk
from services.rag_engine.retrieval.hybrid import RankedChunk, RetrievalResult

# Minimum retrieval quality the CI gate must enforce on every pull request.
AGREED_RETRIEVAL_GATE = {"hit@5": 0.95, "mrr": 0.85, "unanswerable_accuracy": 1.00}


class FakeRetriever:
    def __init__(self, results):
        self.results = results
        self.calls = []

    def retrieve(self, question, top_k, tenant_id):
        self.calls.append((question, top_k, tenant_id))
        return self.results[question]


def _result(question, chunks, latency):
    ranked = [
        RankedChunk(
            chunk=Chunk(
                id=f"{question}-{index}",
                document_id="doc",
                text=text,
                metadata={"filename": filename},
            ),
            rank=index,
            scores=scores,
        )
        for index, (text, filename, scores) in enumerate(chunks, 1)
    ]
    return RetrievalResult(question, 5, ranked, {"total": latency})


def test_evaluate_reports_phrase_metrics_latency_categories_and_real_sufficiency():
    cases = [
        {
            "id": "answerable",
            "category": "factual",
            "question": "How many sick leave days?",
            "answerable": True,
            "expected_doc": "handbook.md",
            "expected_phrases": ["10 days of paid sick leave", "annual entitlement"],
        },
        {
            "id": "unanswerable",
            "category": "unanswerable",
            "question": "What is the private key?",
            "answerable": False,
            "expected_doc": None,
            "expected_phrases": [],
        },
    ]
    retriever = FakeRetriever(
        {
            cases[0]["question"]: _result(
                cases[0]["question"],
                [
                    ("Ten days are available", "other.md", {"dense": 0.2, "bm25": 0}),
                    (
                        "The policy grants 10 days of paid\n sick leave per year",
                        "handbook.md",
                        {"dense": 0.2, "bm25": 1},
                    ),
                ],
                12,
            ),
            cases[1]["question"]: _result(
                cases[1]["question"],
                [("General onboarding steps", "guide.md", {"dense": 0.1, "bm25": 0})],
                30,
            ),
        }
    )

    report = evaluate(retriever, cases, top_k=5, tenant_id="eval", min_dense_score=0.7)

    assert retriever.calls == [
        (cases[0]["question"], 10, "eval"),
        (cases[1]["question"], 10, "eval"),
    ]
    assert report["metrics"]["hit@1"] == 0.0
    assert report["metrics"]["hit@3"] == report["metrics"]["hit@5"] == 1.0
    assert report["metrics"]["recall@5"] == 0.5
    assert report["metrics"]["mrr"] == 0.5
    assert report["metrics"]["unanswerable_accuracy"] == 1.0
    assert report["metrics"]["latency_ms"] == {"p50": 21.0, "p95": 30, "p99": 30}
    assert report["categories"]["factual"]["hit@5"] == 1.0
    assert report["categories"]["factual"]["latency_ms"] == {"p50": 12, "p95": 12, "p99": 12}
    assert report["categories"]["unanswerable"]["unanswerable_accuracy"] == 1.0


def test_unanswerable_accuracy_uses_sufficiency_result_and_threshold_gate():
    cases = [
        {
            "id": "unknown",
            "category": "unanswerable",
            "question": "What is private key?",
            "answerable": False,
            "expected_doc": None,
            "expected_phrases": [],
        }
    ]
    retriever = FakeRetriever(
        {
            cases[0]["question"]: _result(
                cases[0]["question"],
                [("The private key is secret", "guide.md", {"dense": 0.8, "bm25": 0})],
                5,
            )
        }
    )

    report = evaluate(retriever, cases, top_k=5, tenant_id="eval", min_dense_score=0.7)

    assert report["metrics"]["unanswerable_accuracy"] == 0.0
    assert gate_failures(report, {"hit@5": 0.9, "mrr": 0.7, "unanswerable_accuracy": 0.85}) == [
        "hit@5 is undefined",
        "mrr is undefined",
        "unanswerable_accuracy 0.000 < 0.850",
    ]


def test_sufficiency_only_uses_configured_top_k_while_retrieving_ten_for_mrr():
    case = {
        "id": "unknown",
        "category": "unanswerable",
        "question": "What is the private key?",
        "answerable": False,
        "expected_doc": None,
        "expected_phrases": [],
    }
    chunks = [
        ("General onboarding steps", "guide.md", {"dense": 0.1, "bm25": 0})
        for _ in range(5)
    ]
    chunks.append(("The private key is secret", "guide.md", {"dense": 0.9, "bm25": 0}))
    retriever = FakeRetriever({case["question"]: _result(case["question"], chunks, 5)})

    report = evaluate(retriever, [case], top_k=5, min_dense_score=0.7)

    assert retriever.calls == [(case["question"], 10, "eval")]
    assert report["metrics"]["unanswerable_accuracy"] == 1.0


def test_checked_in_retrieval_thresholds_meet_the_agreed_gate():
    thresholds = json.loads(
        (Path(__file__).resolve().parents[1] / "evals" / "thresholds.json").read_text(encoding="utf-8")
    )

    for metric, minimum in AGREED_RETRIEVAL_GATE.items():
        assert thresholds[metric] >= minimum, f"{metric} gate {thresholds[metric]} is looser than agreed {minimum}"
