"""Ingest helpers for Meridian."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from cli_anything.meridian.client import MeridianClient

SUPPORTED_SUFFIXES = {".md", ".markdown", ".txt", ".html", ".htm", ".pdf", ".docx"}


def _collect_files(path: Path, recursive: bool) -> list[Path]:
    if path.is_file():
        if path.suffix.lower() not in SUPPORTED_SUFFIXES:
            raise FileNotFoundError(f"Unsupported file type: {path}")
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
    skipped: list[dict[str, str]] = []
    for f in files:
        try:
            suffix = f.suffix.lower()
            if suffix == ".pdf":
                try:
                    from pypdf import PdfReader
                except Exception:  # noqa: BLE001
                    from PyPDF2 import PdfReader  # type: ignore
                reader = PdfReader(str(f))
                if getattr(reader, "is_encrypted", False):
                    try:
                        reader.decrypt("")
                    except Exception:  # noqa: BLE001
                        skipped.append({"file": str(f), "reason": "encrypted PDF"})
                        continue
                text = "\n".join((page.extract_text() or "") for page in reader.pages)
                if not text.strip():
                    skipped.append({"file": str(f), "reason": "no extractable text (scanned/empty)"})
                    continue
                fmt = "md"
            elif suffix == ".docx":
                from docx import Document as DocxDocument
                doc = DocxDocument(str(f))
                parts = [p.text for p in doc.paragraphs]
                for table in getattr(doc, "tables", []):
                    for row in table.rows:
                        parts.append(" | ".join(cell.text for cell in row.cells))
                text = "\n".join(parts)
                if not text.strip():
                    skipped.append({"file": str(f), "reason": "no extractable text"})
                    continue
                fmt = "md"
            else:
                text = f.read_text(encoding="utf-8", errors="ignore")
                fmt = suffix.lstrip(".").lower()
                if fmt == "htm":
                    fmt = "html"
                if fmt not in {"md", "txt", "html"}:
                    fmt = "txt"
                if not text.strip():
                    skipped.append({"file": str(f), "reason": "empty file"})
                    continue
            data = client.ingest_text(text, title=f.stem, source=str(f), fmt=fmt)
            results.append(data)
        except Exception as exc:  # noqa: BLE001
            skipped.append({"file": str(f), "reason": str(exc)})
    return {"ingested": len(results), "files": results, "skipped": skipped}
