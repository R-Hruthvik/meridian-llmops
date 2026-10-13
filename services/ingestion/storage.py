"""Dedicated disk storage manager for ingested documents, structural chunks, and metadata."""

import json
import logging
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from packages.core.models import Chunk, Document, Entity, Relationship

logger = logging.getLogger("meridian.ingestion.storage")

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_filename(name: str) -> str:
    return _SAFE_NAME.sub("_", Path(name).name)[:120] or "upload"


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """Write via temp file + os.replace so a crash never leaves a half file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def get_default_storage_root() -> Path:
    """Returns test storage directory during pytest runs or production storage path."""
    if os.environ.get("APP_ENV") == "testing":
        return Path("/tmp/meridian_test_storage")
    return Path(__file__).parents[2] / "storage"


class DocumentStorageManager:
    """Manages dedicated, organized physical disk storage for ingested files, chunks, and metadata."""

    def __init__(self, storage_root: Path | str | None = None):
        self.root_dir = Path(storage_root) if storage_root else get_default_storage_root()
        self.docs_dir = self.root_dir / "documents"
        self.meta_dir = self.root_dir / "metadata"
        self.chunks_dir = self.root_dir / "chunks"
        self.originals_dir = self.root_dir / "originals"

        # Ensure all dedicated storage directories exist
        self.docs_dir.mkdir(parents=True, exist_ok=True)
        self.meta_dir.mkdir(parents=True, exist_ok=True)
        self.chunks_dir.mkdir(parents=True, exist_ok=True)
        self.originals_dir.mkdir(parents=True, exist_ok=True)

    def save_document(
        self,
        doc: Document,
        chunks: list[Chunk],
        entities: list[Entity],
        relationships: list[Relationship],
        raw_bytes: bytes | None = None,
        tenant_id: str = "default",
        content_hash: str | None = None,
    ) -> dict[str, Any]:
        """Saves raw file content, structural chunks, and metadata records permanently to disk.

        All writes are atomic; any failure raises (the caller rolls the ingest back).
        """
        now = datetime.now(UTC).isoformat()
        doc_format_str = str(doc.format.value if hasattr(doc.format, "value") else doc.format)

        # 1. Save the original file under originals/<tenant>/<document_id>/
        original_name = _safe_filename(doc.source if doc.source != "manual" else f"{doc.title}.{doc_format_str}")
        original_path = self.originals_dir / _safe_filename(tenant_id) / doc.id / original_name
        if raw_bytes:
            atomic_write_bytes(original_path, raw_bytes)
        else:
            atomic_write_bytes(original_path, doc.text.encode("utf-8"))

        # 2. Save structural chunks to storage/chunks/{doc_id}.json
        chunks_payload = [
            {
                "id": c.id,
                "document_id": doc.id,
                "chunk_index": c.chunk_index,
                "section_heading": c.section_heading,
                "text": c.text,
                "char_count": len(c.text),
                "metadata": c.metadata,
            }
            for c in chunks
        ]
        chunks_file_path = self.chunks_dir / f"{doc.id}.json"
        atomic_write_bytes(chunks_file_path, json.dumps(chunks_payload, indent=2).encode("utf-8"))

        # 3. Save document metadata record to storage/metadata/{doc_id}.json
        meta_record = {
            "id": doc.id,
            "tenant_id": tenant_id,
            "title": doc.title,
            "format": doc_format_str,
            "source": doc.source,
            "filename": original_name,
            "original_path": str(original_path),
            "content_hash": content_hash,
            "created_at": now,
            "updated_at": now,
            "char_count": len(doc.text),
            "chunk_count": len(chunks),
            "entities_count": len(entities),
            "relationships_count": len(relationships),
            "entities": [e.name for e in entities],
            "relationships": [f"{r.source_entity} -[{r.relation_type}]-> {r.target_entity}" for r in relationships],
            "snippet": doc.text[:220] + ("..." if len(doc.text) > 220 else ""),
        }
        meta_file_path = self.meta_dir / f"{doc.id}.json"
        atomic_write_bytes(meta_file_path, json.dumps(meta_record, indent=2).encode("utf-8"))

        return meta_record

    def find_duplicate(self, content_hash: str, tenant_id: str) -> str | None:
        """Return the document_id of an existing document with the same content hash."""
        for meta_file in self.meta_dir.glob("*.json"):
            try:
                data = json.loads(meta_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if data.get("content_hash") == content_hash and data.get("tenant_id", "default") == tenant_id:
                return str(data["id"])
        return None

    def find_by_filename(self, filename: str, tenant_id: str) -> str | None:
        """Return the document_id stored under this exact filename for the tenant."""
        for meta_file in self.meta_dir.glob("*.json"):
            try:
                data = json.loads(meta_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if data.get("source") == filename and data.get("tenant_id", "default") == tenant_id:
                return str(data["id"])
        return None

    def list_documents(self, tenant_id: str | None = None) -> list[dict[str, Any]]:
        """Scans storage/metadata/ and returns all stored documents sorted by creation date."""
        documents: list[dict[str, Any]] = []

        for meta_file in self.meta_dir.glob("*.json"):
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if tenant_id is None or data.get("tenant_id", "default") == tenant_id:
                        documents.append(data)
            except (OSError, ValueError, KeyError) as e:
                logger.warning("Could not read document metadata %s: %s", meta_file, e)

        documents.sort(key=lambda d: d.get("created_at", ""), reverse=True)
        return documents

    def get_document(self, doc_id: str, tenant_id: str | None = None) -> dict[str, Any] | None:
        """Retrieves full document metadata, raw text, and all constituent chunks."""
        meta_file = self.meta_dir / f"{doc_id}.json"
        if not meta_file.exists():
            return None

        try:
            with open(meta_file, "r", encoding="utf-8") as f:
                meta = json.load(f)
            if tenant_id is not None and meta.get("tenant_id", "default") != tenant_id:
                return None

            # Load chunks
            chunks_file = self.chunks_dir / f"{doc_id}.json"
            chunks = []
            if chunks_file.exists():
                with open(chunks_file, "r", encoding="utf-8") as f:
                    chunks = json.load(f)
                    for chunk in chunks:
                        chunk.pop("embedding", None)

            # Load raw document text
            filename = meta.get("filename")
            raw_text = ""
            original_path = meta.get("original_path")
            if original_path and Path(original_path).exists():
                raw_text = Path(original_path).read_text(encoding="utf-8", errors="ignore")
            elif filename:
                for candidate in self.originals_dir.glob(f"*/{doc_id}/{filename}"):
                    raw_text = candidate.read_text(encoding="utf-8", errors="ignore")
                    break
                else:
                    legacy = self.docs_dir / filename
                    if legacy.exists():
                        raw_text = legacy.read_text(encoding="utf-8", errors="ignore")

            meta["chunks"] = chunks  # type: ignore[typeddict-unknown-key]
            meta["text"] = raw_text  # type: ignore[typeddict-unknown-key]
            return meta  # type: ignore[no-any-return]
        except (OSError, ValueError, KeyError) as e:
            logger.error("Failed to load document %s: %s", doc_id, e)
            return None

    def get_document_chunks(self, doc_id: str, *, strict: bool = False) -> list[Chunk]:
        """Loads and reconstructs Chunk domain objects for a document from storage."""
        chunks_file = self.chunks_dir / f"{doc_id}.json"
        if not chunks_file.exists():
            return []

        chunks: list[Chunk] = []
        try:
            with open(chunks_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            if strict and not isinstance(data, list):
                raise ValueError(f"Chunk records in {chunks_file} must be a list")
            for c in data:
                chunks.append(
                    Chunk(
                        id=c["id"],
                        document_id=c.get("document_id", doc_id),
                        text=c["text"],
                        chunk_index=c.get("chunk_index", 0),
                        section_heading=c.get("section_heading"),
                        metadata=c.get("metadata", {}),
                    )
                )
        except (OSError, ValueError, KeyError) as e:
            if strict:
                raise
            logger.error("Failed to load chunks for doc %s: %s", doc_id, e)

        return chunks

    def load_all_chunks(self, *, strict: bool = False) -> list[Chunk]:
        """Loads all chunks across all stored documents in storage/chunks/."""
        all_chunks: list[Chunk] = []
        for chunks_file in sorted(self.chunks_dir.glob("*.json")):
            doc_id = chunks_file.stem
            chunks = self.get_document_chunks(doc_id, strict=strict)
            all_chunks.extend(chunks)
        return all_chunks

    def has_legacy_embeddings(self) -> bool:
        """Legacy disk vectors cannot prove semantic index provenance."""
        for path in self.chunks_dir.glob("*.json"):
            records = json.loads(path.read_text(encoding="utf-8"))
            if any("embedding" in record for record in records):
                return True
        return False

    def remove_legacy_embeddings(self) -> None:
        """Strip old vectors only after a successful reindex."""
        for path in self.chunks_dir.glob("*.json"):
            records = json.loads(path.read_text(encoding="utf-8"))
            if any("embedding" in record for record in records):
                for record in records:
                    record.pop("embedding", None)
                temporary = path.with_suffix(".json.tmp")
                temporary.write_text(json.dumps(records, indent=2), encoding="utf-8")
                temporary.replace(path)

    def remove_document_files(self, doc_id: str) -> None:
        """Remove every disk artifact of a document (transaction rollback and delete)."""
        meta_file = self.meta_dir / f"{doc_id}.json"
        chunks_file = self.chunks_dir / f"{doc_id}.json"
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            meta = {}
        # The metadata write is last, so a failed save may leave an original
        # without a catalog record. Find it by document id as well.
        for document_dir in self.originals_dir.glob(f"*/{doc_id}"):
            if document_dir.is_dir():
                for path in document_dir.iterdir():
                    if path.is_file():
                        path.unlink(missing_ok=True)
                document_dir.rmdir()
                tenant_dir = document_dir.parent
                if not any(tenant_dir.iterdir()):
                    tenant_dir.rmdir()
        if not meta.get("original_path") and meta.get("filename"):
            (self.docs_dir / Path(str(meta["filename"])).name).unlink(missing_ok=True)
        meta_file.unlink(missing_ok=True)
        chunks_file.unlink(missing_ok=True)

    def delete_document(self, doc_id: str, tenant_id: str | None = None) -> bool:
        """Permanently deletes a document, its raw file, chunks, and metadata from disk."""
        meta_file = self.meta_dir / f"{doc_id}.json"
        if not meta_file.exists():
            return False
        if tenant_id is not None:
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return False
            if meta.get("tenant_id", "default") != tenant_id:
                return False
        self.remove_document_files(doc_id)
        return True

    def clear_all(self) -> int:
        """Removes all documents, chunks, and metadata files from dedicated storage."""
        count = 0
        for meta_file in self.meta_dir.glob("*.json"):
            doc_id = meta_file.stem
            self.delete_document(doc_id)
            count += 1
        return count
