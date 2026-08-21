"""Dedicated disk storage manager for ingested documents, structural chunks, and metadata."""

import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from packages.core.models import Chunk, Document, Entity, Relationship

logger = logging.getLogger("meridian.ingestion.storage")


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

        # Ensure all dedicated storage directories exist
        self.docs_dir.mkdir(parents=True, exist_ok=True)
        self.meta_dir.mkdir(parents=True, exist_ok=True)
        self.chunks_dir.mkdir(parents=True, exist_ok=True)

    def save_document(
        self,
        doc: Document,
        chunks: list[Chunk],
        entities: list[Entity],
        relationships: list[Relationship],
        raw_bytes: bytes | None = None,
    ) -> dict[str, Any]:
        """Saves raw file content, structural chunks, and metadata records permanently to disk."""
        now = datetime.now(UTC).isoformat()
        doc_format_str = str(doc.format.value if hasattr(doc.format, "value") else doc.format)

        # 1. Save physical raw document file to storage/documents/
        clean_filename = f"{doc.id}_{Path(doc.source).name if doc.source != 'manual' else f'{doc.title}.{doc_format_str}'}"
        # Sanitize filename
        clean_filename = "".join(c for c in clean_filename if c.isalnum() or c in "._- ")
        doc_file_path = self.docs_dir / clean_filename

        try:
            if raw_bytes:
                doc_file_path.write_bytes(raw_bytes)
            else:
                doc_file_path.write_text(doc.text, encoding="utf-8")
        except OSError as e:
            logger.error("Failed to write document file %s: %s", doc_file_path, e)

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
                "embedding": c.embedding,
            }
            for c in chunks
        ]
        chunks_file_path = self.chunks_dir / f"{doc.id}.json"
        try:
            with open(chunks_file_path, "w", encoding="utf-8") as f:
                json.dump(chunks_payload, f, indent=2)
        except OSError as e:
            logger.error("Failed to write chunks file %s: %s", chunks_file_path, e)

        # 3. Save document metadata record to storage/metadata/{doc_id}.json
        meta_record = {
            "id": doc.id,
            "title": doc.title,
            "format": doc_format_str,
            "source": doc.source,
            "filename": clean_filename,
            "file_path": str(doc_file_path.relative_to(self.root_dir.parent)),
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
        try:
            with open(meta_file_path, "w", encoding="utf-8") as f:
                json.dump(meta_record, f, indent=2)
        except OSError as e:
            logger.error("Failed to write metadata file %s: %s", meta_file_path, e)

        return meta_record

    def list_documents(self) -> list[dict[str, Any]]:
        """Scans storage/metadata/ and returns all stored documents sorted by creation date."""
        documents: list[dict[str, Any]] = []

        for meta_file in self.meta_dir.glob("*.json"):
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    documents.append(data)
            except (OSError, ValueError, KeyError) as e:
                logger.warning("Could not read document metadata %s: %s", meta_file, e)

        documents.sort(key=lambda d: d.get("created_at", ""), reverse=True)
        return documents

    def get_document(self, doc_id: str) -> dict[str, Any] | None:
        """Retrieves full document metadata, raw text, and all constituent chunks."""
        meta_file = self.meta_dir / f"{doc_id}.json"
        if not meta_file.exists():
            return None

        try:
            with open(meta_file, "r", encoding="utf-8") as f:
                meta = json.load(f)

            # Load chunks
            chunks_file = self.chunks_dir / f"{doc_id}.json"
            chunks = []
            if chunks_file.exists():
                with open(chunks_file, "r", encoding="utf-8") as f:
                    chunks = json.load(f)

            # Load raw document text
            filename = meta.get("filename")
            raw_text = ""
            if filename:
                doc_path = self.docs_dir / filename
                if doc_path.exists():
                    raw_text = doc_path.read_text(encoding="utf-8", errors="ignore")

            meta["chunks"] = chunks
            meta["text"] = raw_text
            return meta
        except (OSError, ValueError, KeyError) as e:
            logger.error("Failed to load document %s: %s", doc_id, e)
            return None

    def get_document_chunks(self, doc_id: str) -> list[Chunk]:
        """Loads and reconstructs Chunk domain objects for a document from storage."""
        chunks_file = self.chunks_dir / f"{doc_id}.json"
        if not chunks_file.exists():
            return []

        chunks: list[Chunk] = []
        try:
            with open(chunks_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            for c in data:
                chunks.append(
                    Chunk(
                        id=c["id"],
                        document_id=c.get("document_id", doc_id),
                        text=c["text"],
                        chunk_index=c.get("chunk_index", 0),
                        section_heading=c.get("section_heading"),
                        metadata=c.get("metadata", {}),
                        embedding=c.get("embedding"),
                    )
                )
        except (OSError, ValueError, KeyError) as e:
            logger.error("Failed to load chunks for doc %s: %s", doc_id, e)

        return chunks

    def load_all_chunks(self) -> list[Chunk]:
        """Loads all chunks across all stored documents in storage/chunks/."""
        all_chunks: list[Chunk] = []
        for chunks_file in self.chunks_dir.glob("*.json"):
            doc_id = chunks_file.stem
            chunks = self.get_document_chunks(doc_id)
            all_chunks.extend(chunks)
        return all_chunks

    def delete_document(self, doc_id: str) -> bool:
        """Permanently deletes a document, its raw file, chunks, and metadata from disk."""
        meta_file = self.meta_dir / f"{doc_id}.json"
        chunks_file = self.chunks_dir / f"{doc_id}.json"

        if not meta_file.exists():
            return False

        try:
            with open(meta_file, "r", encoding="utf-8") as f:
                meta = json.load(f)
            filename = meta.get("filename")
            if filename:
                doc_file = self.docs_dir / filename
                if doc_file.exists():
                    doc_file.unlink()
        except OSError as e:
            logger.warning("Could not delete raw document file for %s: %s", doc_id, e)

        if meta_file.exists():
            meta_file.unlink()
        if chunks_file.exists():
            chunks_file.unlink()

        return True

    def clear_all(self) -> int:
        """Removes all documents, chunks, and metadata files from dedicated storage."""
        count = 0
        for meta_file in self.meta_dir.glob("*.json"):
            doc_id = meta_file.stem
            self.delete_document(doc_id)
            count += 1
        return count
