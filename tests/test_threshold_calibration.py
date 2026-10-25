import json
import subprocess
import sys

import pytest

from packages.core.errors import IndexReadError, IndexWriteError, IngestionError
from scripts import calibrate_threshold


def test_recommend_threshold_uses_hand_calculated_youden_j_and_stable_tie():
    recommendation = calibrate_threshold.recommend_threshold(
        answerable_scores=[0.70], unanswerable_scores=[0.30]
    )

    assert recommendation["threshold"] == 0.70
    assert recommendation["youden_j"] == 1.0
    assert recommendation["accuracy"] == 1.0
    assert recommendation["true_positive"] == 1
    assert recommendation["true_negative"] == 1


def test_recommend_threshold_handles_empty_groups_and_rejects_unknown_metric():
    empty = calibrate_threshold.recommend_threshold([], [0.2])
    assert empty["threshold"] is None
    assert empty["youden_j"] is None

    try:
        calibrate_threshold.recommend_threshold([0.8], [0.2], metric="f1")
    except ValueError as error:
        assert "metric" in str(error)
    else:
        raise AssertionError("unknown optimization metrics must be rejected")


def test_cli_calibrates_supplied_questions_and_writes_json_summary(tmp_path, monkeypatch, capsys):
    questions = tmp_path / "questions.json"
    questions.write_text(
        json.dumps({"cases": [
            {"id": "yes", "question": "known", "answerable": True},
            {"id": "no", "question": "unknown", "answerable": False},
        ]}),
        encoding="utf-8",
    )
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "guide.md").write_text("evaluation fixture", encoding="utf-8")
    output = tmp_path / "result.json"

    class Embedder:
        def embed_query(self, question):
            return [question]

    class Store:
        def count(self, tenant_id):
            return 1

        def search(self, vector, k, tenant_id):
            return [type("Hit", (), {"score": 0.8 if vector[0] == "known" else 0.2})()]

    class BM25:
        def search(self, question, top_k):
            return []

    class Retriever:
        embedder = Embedder()
        bm25_index = BM25()

    monkeypatch.setattr(calibrate_threshold, "build_engine", lambda *args: (Retriever(), Store()))
    from packages.core import settings

    monkeypatch.setattr(
        settings, "get_settings", lambda: type("Settings", (), {
            "embedding_model": "test-model", "fastembed_cache_path": str(tmp_path / "cache")
        })()
    )

    result = calibrate_threshold.main([
        "--questions", str(questions), "--docs", str(docs), "--output", str(output)
    ])

    assert result == 0
    saved = json.loads(output.read_text(encoding="utf-8"))
    assert saved["recommendation"]["threshold"] == 0.8
    assert [row["id"] for row in saved["answerable"]] == ["yes"]
    assert [row["id"] for row in saved["unanswerable"]] == ["no"]
    assert "recommended threshold" in capsys.readouterr().out.lower()


def test_script_entrypoint_loads_when_run_directly():
    result = subprocess.run(
        [sys.executable, "scripts/calibrate_threshold.py", "--help"],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    assert "--questions" in result.stdout


@pytest.mark.parametrize("docs_kind", ["missing", "empty"])
def test_cli_rejects_missing_or_empty_docs_without_traceback(tmp_path, docs_kind):
    questions = tmp_path / "questions.json"
    questions.write_text(json.dumps({"cases": [
        {"id": "yes", "question": "known", "answerable": True},
        {"id": "no", "question": "unknown", "answerable": False},
    ]}), encoding="utf-8")
    docs = tmp_path / "docs"
    if docs_kind == "empty":
        docs.mkdir()

    output = tmp_path / "out.json"
    result = subprocess.run(
        [
            sys.executable, "scripts/calibrate_threshold.py", "--questions", str(questions),
            "--docs", str(docs), "--output", str(output),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 2
    assert "docs" in result.stderr.lower()
    assert "traceback" not in result.stderr.lower()
    assert not output.exists()


@pytest.mark.parametrize("contents", ["not-json", json.dumps({"cases": []})])
def test_cli_reports_invalid_questions_without_traceback(tmp_path, capsys, contents):
    questions = tmp_path / "questions.json"
    questions.write_text(contents, encoding="utf-8")
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "guide.md").write_text("content", encoding="utf-8")

    result = calibrate_threshold.main([
        "--questions", str(questions), "--docs", str(docs), "--output", str(tmp_path / "out.json")
    ])

    captured = capsys.readouterr()
    assert result == 2
    assert "error:" in captured.err.lower()
    assert "traceback" not in captured.err.lower()
    assert not (tmp_path / "out.json").exists()


def test_cli_rejects_supported_but_empty_text_file(tmp_path):
    questions = tmp_path / "questions.json"
    questions.write_text(json.dumps({"cases": [
        {"id": "yes", "question": "known", "answerable": True},
        {"id": "no", "question": "unknown", "answerable": False},
    ]}), encoding="utf-8")
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "empty.txt").write_text("", encoding="utf-8")
    output = tmp_path / "out.json"

    result = subprocess.run(
        [
            sys.executable, "scripts/calibrate_threshold.py", "--questions", str(questions),
            "--docs", str(docs), "--output", str(output),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 2
    assert ("no indexed chunks" in result.stderr.lower()) or ("contains no extractable text" in result.stderr.lower())
    assert "traceback" not in result.stderr.lower()
    assert not output.exists()


@pytest.mark.parametrize("error", [IngestionError, IndexReadError, IndexWriteError])
def test_cli_formats_known_ingestion_and_index_errors(tmp_path, monkeypatch, capsys, error):
    questions = tmp_path / "questions.json"
    questions.write_text(json.dumps({"cases": [
        {"id": "yes", "question": "known", "answerable": True},
        {"id": "no", "question": "unknown", "answerable": False},
    ]}), encoding="utf-8")
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "guide.md").write_text("content", encoding="utf-8")
    output = tmp_path / "out.json"

    def fail_build(*args):
        raise error("expected indexing failure")

    monkeypatch.setattr(calibrate_threshold, "build_engine", fail_build)
    result = calibrate_threshold.main([
        "--questions", str(questions), "--docs", str(docs), "--output", str(output)
    ])

    captured = capsys.readouterr()
    assert result == 2
    assert "expected indexing failure" in captured.err
    assert "traceback" not in captured.err.lower()
    assert not output.exists()
