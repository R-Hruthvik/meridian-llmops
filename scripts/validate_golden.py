"""Validate the golden question dataset against its source documents."""

import argparse
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = {
    "factual",
    "numeric",
    "paraphrase",
    "identifier",
    "near_duplicate",
    "unanswerable",
    "multi_chunk",
}
FIELDS = {
    "id",
    "category",
    "question",
    "answerable",
    "expected_doc",
    "expected_phrases",
    "notes",
}


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).casefold().strip()


def validate_dataset(dataset_path: Path, docs_dir: Path) -> list[str]:
    """Return schema and source-document errors for a golden dataset."""
    errors: list[str] = []
    try:
        cases: Any = json.loads(dataset_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"cannot read dataset: {exc}"]

    if not isinstance(cases, list):
        return ["dataset must be a JSON array"]

    seen_ids: set[str] = set()
    for index, case in enumerate(cases):
        label = f"case {index + 1}"
        if not isinstance(case, dict):
            errors.append(f"{label} must be an object")
            continue
        missing = FIELDS - case.keys()
        extra = case.keys() - FIELDS
        if missing:
            errors.append(f"{label} missing fields: {', '.join(sorted(missing))}")
        if extra:
            errors.append(f"{label} has unknown fields: {', '.join(sorted(extra))}")
        if missing:
            continue

        case_id = case["id"]
        if not isinstance(case_id, str) or not case_id.strip():
            errors.append(f"{label} id must be a non-empty string")
        elif case_id in seen_ids:
            errors.append(f"{label} duplicates id {case_id!r}")
        else:
            seen_ids.add(case_id)
        if not isinstance(case["category"], str) or case["category"] not in CATEGORIES:
            errors.append(f"{label} category must be one of {', '.join(sorted(CATEGORIES))}")
        if not isinstance(case["question"], str) or not case["question"].strip():
            errors.append(f"{label} question must be a non-empty string")
        if not isinstance(case["answerable"], bool):
            errors.append(f"{label} answerable must be a boolean")
        if not isinstance(case["notes"], str) or not case["notes"].strip():
            errors.append(f"{label} notes must be a non-empty string")

        phrases = case["expected_phrases"]
        if not isinstance(phrases, list) or any(
            not isinstance(phrase, str) or not phrase.strip() for phrase in phrases
        ):
            errors.append(f"{label} expected_phrases must be an array of non-empty strings")
            continue

        expected_doc = case["expected_doc"]
        if case["answerable"]:
            if not isinstance(expected_doc, str) or not expected_doc.strip():
                errors.append(f"{label} answerable case needs an expected_doc")
                continue
            if not phrases:
                errors.append(f"{label} answerable case needs expected_phrases")
                continue
            doc_path = (docs_dir / expected_doc).resolve()
            if docs_dir.resolve() not in doc_path.parents or not doc_path.is_file():
                errors.append(f"{label} expected_doc does not exist in {docs_dir}: {expected_doc}")
                continue
            try:
                document = _normalize(doc_path.read_text(encoding="utf-8"))
            except OSError as exc:
                errors.append(f"{label} cannot read expected_doc {expected_doc}: {exc}")
                continue
            for phrase in phrases:
                if _normalize(phrase) not in document:
                    errors.append(
                        f"{label} expected phrase {phrase!r} does not occur in {expected_doc}"
                    )
        else:
            if expected_doc is not None:
                errors.append(f"{label} unanswerable case must have expected_doc null")
            if phrases:
                errors.append(f"{label} unanswerable case must have no expected_phrases")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=ROOT / "evals/golden_dataset.json")
    parser.add_argument("--docs", type=Path, default=ROOT / "sample_docs")
    args = parser.parse_args()
    errors = validate_dataset(args.dataset, args.docs)
    if errors:
        print("Golden dataset validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    count = len(json.loads(args.dataset.read_text(encoding="utf-8")))
    print(f"Golden dataset valid: {count} cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
