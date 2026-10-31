"""Inspect chunk sizes and parsed text for a stored document or source file."""

import argparse
import json
import math
import re
import statistics
import sys
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.ingestion.chunker import TokenAwareChunker, count_tokens
from services.ingestion.parsers import parse_file
from services.ingestion.parsers.base import ParsedDocument
from services.ingestion.storage import DocumentStorageManager


def _percentile_95(values: list[int]) -> int:
    return sorted(values)[max(0, math.ceil(0.95 * len(values)) - 1)] if values else 0


def _empty_page_numbers(parsed: Any) -> list[int]:
    pages = parsed.pages
    if not pages:
        return []
    line_counts: dict[str, int] = {}
    for page in pages:
        for line in {line.strip() for line in page.text.splitlines() if len(line.strip()) >= 3}:
            line_counts[line] = line_counts.get(line, 0) + 1
    threshold = max(2, int(0.6 * len(pages)))
    repeated = {
        line for line, count in line_counts.items() if count >= threshold and len(pages) >= 3
    }
    empty: list[int] = []
    for page in pages:
        content = "\n".join(
            line for line in page.text.splitlines() if line.strip() not in repeated
        ).strip()
        if len(re.sub(r"\s", "", content)) < 20:
            empty.append(page.number)
    return empty


def _report(chunks: list[dict[str, Any]], *, filename: str, parsed: Any = None) -> None:
    texts = [str(chunk.get("text", "")) for chunk in chunks]
    counts = [count_tokens(text) for text in texts]
    pages_covered: set[int] = set()
    for chunk in chunks:
        metadata = chunk.get("metadata", {})
        start, end = metadata.get("page_start"), metadata.get("page_end")
        if isinstance(start, int) and isinstance(end, int):
            pages_covered.update(range(start, end + 1))
        elif isinstance(start, int):
            pages_covered.add(start)
    empty_pages = _empty_page_numbers(parsed) if parsed else []

    print(f"document: {filename}")
    print(f"chunk count: {len(chunks)}")
    median = statistics.median(counts) if counts else 0
    print(
        f"token counts: min={min(counts, default=0)} median={median:g} "
        f"p95={_percentile_95(counts)} max={max(counts, default=0)}"
    )
    print(f"pages covered: {sorted(pages_covered)}")
    print(f"empty pages: {empty_pages}")
    for index, text in enumerate(texts[:3]):
        print(f"\nchunk {index + 1} (first):\n{text}")
    if texts:
        print(f"\nchunk {len(texts)} (last):\n{texts[-1]}")
    if parsed and parsed.warnings:
        print(f"warnings: {json.dumps(parsed.warnings, ensure_ascii=False)}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("document", help="Stored document ID or path to a supported file")
    parser.add_argument("--storage-root", type=Path, default=None)
    args = parser.parse_args(argv)
    parsed: ParsedDocument | None = None
    source = Path(args.document)
    if source.is_file():
        try:
            parsed = parse_file(source.name, source.read_bytes())
            chunks = TokenAwareChunker().chunk_document(
                parsed,
                doc_id="chunk-report",
                source=source.name,
                source_format=parsed.format.value,
                title=parsed.title,
            )
        except Exception as error:  # noqa: BLE001 - parser errors vary by supported format
            print(f"Could not parse {source}: {error}", file=sys.stderr)
            return 1
        _report(
            [chunk.model_dump(exclude={"embedding"}) for chunk in chunks],
            filename=source.name,
            parsed=parsed,
        )
        return 0

    storage = DocumentStorageManager(args.storage_root)
    document = storage.get_document(args.document)
    if document is None:
        print(f"Document ID not found: {args.document}", file=sys.stderr)
        return 1
    original = Path(document.get("original_path", ""))
    if original.is_file():
        try:
            parsed = parse_file(original.name, original.read_bytes())
        except Exception as error:  # noqa: BLE001 - parser errors vary by supported format
            print(f"Could not reparse original {original}: {error}", file=sys.stderr)
            return 1
    _report(
        document.get("chunks", []),
        filename=document.get("filename") or args.document,
        parsed=parsed,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
