"""Ingest supported files from a folder directly through the ingestion pipeline."""

import argparse
import sys
import time
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from qdrant_client import QdrantClient

from packages.core.settings import get_settings
from services.ingestion.embedder import FastEmbedEmbedder
from services.ingestion.pipeline import IngestionPipeline
from services.ingestion.storage import get_default_storage_root
from services.ingestion.vector_store import QdrantChunkStore

SUPPORTED_SUFFIXES = {".md", ".markdown", ".txt", ".pdf", ".docx", ".html", ".htm"}


def build_pipeline(
    storage_root: Path | None, qdrant_path: str | None
) -> tuple[IngestionPipeline, QdrantClient]:
    settings = get_settings()
    embedder = FastEmbedEmbedder(
        settings.embedding_model,
        cache_path=settings.fastembed_cache_path,
        expected_dim=settings.qdrant_vector_dim,
    )
    local_path = qdrant_path
    if storage_root is not None and local_path is None:
        local_path = str(storage_root / "qdrant")
    elif local_path is None and settings.vector_backend == "qdrant_local":
        local_path = settings.qdrant_local_path
    if local_path == ":memory:":
        client = QdrantClient(":memory:")
    elif local_path is not None:
        client = QdrantClient(path=local_path)
    else:
        client = QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)
    store = QdrantChunkStore(client, settings.qdrant_collection, embedder.dim)
    store.ensure_collection()
    return IngestionPipeline(
        vector_store=store,
        embedder=embedder,
        storage_root=storage_root,
        max_upload_bytes=settings.max_upload_mb * 1024 * 1024,
    ), client


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--recursive", action="store_true")
    parser.add_argument("--tenant", default="default")
    parser.add_argument(
        "--storage-root", type=Path, help="Override storage for an isolated benchmark"
    )
    parser.add_argument("--qdrant-path", help="Use a local Qdrant path for an isolated benchmark")
    args = parser.parse_args(argv)
    target = args.directory
    if args.qdrant_path and (
        args.storage_root is None
        or args.storage_root.resolve() == get_default_storage_root().resolve()
    ):
        parser.error("--qdrant-path requires an isolated --storage-root")
    if target.is_file():
        if target.suffix.lower() not in SUPPORTED_SUFFIXES:
            parser.error(f"unsupported file: {target}")
        files = [target]
    else:
        if not target.is_dir():
            parser.error(f"not a directory: {target}")
        glob = "**/*" if args.recursive else "*"
        files = sorted(
            path
            for path in target.glob(glob)
            if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
        )
    # normalize filename relative to parent for single file
    base_dir = target.parent if target.is_file() else target
    pipeline, client = build_pipeline(args.storage_root, args.qdrant_path)
    successes = duplicates = failures = indexed_chunks = 0
    started = time.perf_counter()
    try:
        for path in files:
            file_started = time.perf_counter()
            fmt = path.suffix.lower().lstrip(".")
            filename = path.relative_to(base_dir).as_posix()
            try:
                result = pipeline.ingest_file(filename, path.read_bytes(), tenant_id=args.tenant)
                fmt = result.format or fmt
                warnings = "; ".join(result.warnings) or "none"
                if result.status == "duplicate":
                    duplicates += 1
                    state = f"duplicate duplicate_of={result.duplicate_of}"
                elif result.status == "rejected":
                    failures += 1
                    state = f"failed {result.error or 'rejected'}"
                else:
                    successes += 1
                    indexed_chunks += result.chunks
                    state = result.status
                print(
                    f"{filename}: {state}; format={fmt}; pages={result.pages}; chunks={result.chunks}; "
                    f"seconds={time.perf_counter() - file_started:.2f}; warnings={warnings}"
                )
            except Exception as error:  # noqa: BLE001 - continue the batch and report each failed file
                failures += 1
                print(
                    f"{filename}: failed; format={fmt}; pages=0; chunks=0; "
                    f"seconds={time.perf_counter() - file_started:.2f}; warnings=none; error={error}"
                )
    finally:
        client.close()

    elapsed = time.perf_counter() - started
    count = len(files)
    print("\nSummary")
    print("Status       Files")
    print(f"Indexed      {successes}")
    print(f"Duplicates   {duplicates}")
    print(f"Failed       {failures}")
    print(f"Total        {count}")
    print(f"Indexed chunks {indexed_chunks}")
    print(f"Elapsed      {elapsed:.2f}s ({count / elapsed if elapsed else 0:.2f} files/s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
