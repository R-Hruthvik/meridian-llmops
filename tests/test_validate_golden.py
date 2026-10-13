import json
from pathlib import Path

from scripts.validate_golden import validate_dataset


def test_validator_accepts_valid_golden_case(tmp_path: Path) -> None:
    docs = tmp_path / "sample_docs"
    docs.mkdir()
    (docs / "handbook.md").write_text("Employees receive 10 days of paid sick leave.")
    dataset = tmp_path / "golden.json"
    dataset.write_text(
        json.dumps(
            [
                {
                    "id": "q-001",
                    "category": "numeric",
                    "question": "How much sick leave do employees receive?",
                    "answerable": True,
                    "expected_doc": "handbook.md",
                    "expected_phrases": ["10 days of paid sick leave"],
                    "notes": "Sick leave allowance.",
                }
            ]
        )
    )

    assert validate_dataset(dataset, docs) == []


def test_validator_reports_missing_expected_phrase(tmp_path: Path) -> None:
    docs = tmp_path / "sample_docs"
    docs.mkdir()
    (docs / "handbook.md").write_text("Employees receive 10 days of paid sick leave.")
    dataset = tmp_path / "golden.json"
    dataset.write_text(
        json.dumps(
            [
                {
                    "id": "q-001",
                    "category": "numeric",
                    "question": "How much sick leave do employees receive?",
                    "answerable": True,
                    "expected_doc": "handbook.md",
                    "expected_phrases": ["15 days of paid sick leave"],
                    "notes": "Sick leave allowance.",
                }
            ]
        )
    )

    errors = validate_dataset(dataset, docs)

    assert any("expected phrase" in error for error in errors)


def test_validator_reports_schema_errors(tmp_path: Path) -> None:
    docs = tmp_path / "sample_docs"
    docs.mkdir()
    (docs / "handbook.md").write_text("Employees receive 10 days of paid sick leave.")
    dataset = tmp_path / "golden.json"
    dataset.write_text(
        json.dumps(
            [
                {
                    "id": "q-001",
                    "category": "unknown",
                    "question": "How much sick leave do employees receive?",
                    "answerable": True,
                    "expected_doc": "handbook.md",
                    "expected_phrases": ["10 days of paid sick leave"],
                    "notes": "Sick leave allowance.",
                }
            ]
        )
    )

    errors = validate_dataset(dataset, docs)

    assert any("category" in error for error in errors)
