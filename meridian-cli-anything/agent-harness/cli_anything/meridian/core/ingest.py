"""Ingest helpers for Meridian."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from cli_anything.meridian.client import MeridianClient

SUPPORTED_SUFFIXES = {".md", ".txt", ".html", ".htm"}


def _collect_files(path: Path, recursive: bool) -> list[Path]:
    if path.is_file():
        return [path]
    if not path.is_dir():
        raise FileNotFoundError(str(path))
    if recursive:
        return sorted(p for p in path.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED_SUFFIXES)
    return sorted(p for p in path.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_SUFFIXES)


def ingest_path(client: MeridianClient, path: str, recursive: bool = False) -> dict[str, Any]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(str(p))
    files = _collect_files(p, recursive)
    if not files:
        raise FileNotFoundError(f"No supported files found in {path}")
    results: list[dict[str, Any]] = []
    for f in files:
        text = f.read_text(encoding="utf-8", errors="ignore")
        fmt = f.suffix.lstrip(".").lower()
        if fmt == "htm":
            fmt = "html"
        if fmt not in {"md", "txt", "html"}:
            fmt = "txt"
        data = client.ingest_text(text, title=f.stem, source=str(f), fmt=fmt)
        results.append(data)
    return {"ingested": len(results), "files": results}
