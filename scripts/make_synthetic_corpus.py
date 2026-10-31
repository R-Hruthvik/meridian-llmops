"""Generate a deterministic mixed-format corpus for bulk-ingestion benchmarks."""

import argparse
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FORMATS = (".md", ".txt", ".html")


def generate_corpus(directory: Path, count: int = 200) -> list[Path]:
    if count < 200:
        raise ValueError("synthetic corpus must contain at least 200 files")
    paths = [
        directory / f"synthetic_{index:04d}{FORMATS[index % len(FORMATS)]}"
        for index in range(count)
    ]
    existing = [path for path in paths if path.exists()]
    if existing:
        raise FileExistsError(f"refusing to overwrite existing corpus file: {existing[0]}")

    directory.mkdir(parents=True, exist_ok=True)
    for index, path in enumerate(paths):
        body = (
            f"Synthetic benchmark document {index}.\n\n"
            f"Record {index} describes the Meridian ingestion benchmark. "
            "Qdrant stores vectors while BM25 provides lexical retrieval. "
            "This stable passage supports repeatable corpus-scale retrieval checks.\n"
        )
        if path.suffix == ".md":
            content = f"# Benchmark document {index}\n\n{body}"
        elif path.suffix == ".html":
            content = (
                f"<html><body><h1>Benchmark document {index}</h1><p>{body}</p></body></html>\n"
            )
        else:
            content = body
        path.write_text(content, encoding="utf-8")
    return paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--count", type=int, default=200)
    args = parser.parse_args(argv)
    if args.count < 200:
        parser.error("--count must be at least 200")
    try:
        paths = generate_corpus(args.directory, args.count)
    except (OSError, ValueError) as error:
        print(f"Could not create synthetic corpus: {error}", file=sys.stderr)
        return 1
    counts = {suffix: sum(path.suffix == suffix for path in paths) for suffix in FORMATS}
    print(
        f"Created {len(paths)} files in {args.directory}: "
        + ", ".join(f"{fmt}={n}" for fmt, n in counts.items())
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
