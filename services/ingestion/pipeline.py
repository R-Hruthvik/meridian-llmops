"""Transactional ingestion pipeline: parse -> chunk -> embed -> index -> persist.

Any failure rolls back every store touched by the file being ingested and raises
``IngestionError``; success is only reported when disk, Qdrant, and the catalog
all agree.
"""

import hashlib
import logging
import uuid
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from packages.core.errors import IngestionError
from packages.core.guardrails import has_possible_prompt_injection
from packages.core.models import Chunk, Document, DocumentFormat
from services.ingestion.chunker import CHUNKER_VERSION, TokenAwareChunker, embedded_text
from services.ingestion.embedder import Embedder
from services.ingestion.graph_store import KnowledgeGraphStore
from services.ingestion.manifest import IndexManifest, write_manifest
from services.ingestion.parsers import parse_file, parse_text
from services.ingestion.storage import DocumentStorageManager, atomic_write_bytes
from services.ingestion.vector_store import QdrantChunkStore

logger = logging.getLogger("meridian.ingestion.pipeline")

EMBED_BATCH_SIZE = 64


@dataclass(frozen=True)
class IngestResult:
    """Per-file ingestion outcome reported to API callers and bulk scripts."""

    filename: str
    status: str  # indexed | indexed_with_warnings | duplicate | rejected
    document_id: str | None = None
    format: str | None = None
    pages: int = 0
    chunks: int = 0
    warnings: list[str] = field(default_factory=list)
    duplicate_of: str | None = None
    error: str | None = None
    entities_extracted: int = 0
    relationships_extracted: int = 0
    created_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "filename": self.filename,
            "status": self.status,
            "document_id": self.document_id,
            "format": self.format,
            "pages": self.pages,
            "chunks": self.chunks,
            "warnings": self.warnings,
            "duplicate_of": self.duplicate_of,
            "error": self.error,
            "entities_extracted": self.entities_extracted,
            "relationships_extracted": self.relationships_extracted,
            "created_at": self.created_at,
        }


class IngestionPipeline:
    """Coordinates parsing, token-aware chunking, storage, Qdrant indexing, and graph extraction."""

    def __init__(
        self,
        vector_store: QdrantChunkStore,
        graph_store: KnowledgeGraphStore | None = None,
        storage_manager: DocumentStorageManager | None = None,
        in_memory: bool = True,
        storage_root: Path | str | None = None,
        embedder: Embedder | None = None,
        max_upload_bytes: int = 25 * 1024 * 1024,
    ):
        self.vector_store = vector_store
        self.embedder = embedder
        self.graph_store = graph_store or KnowledgeGraphStore(in_memory=in_memory)
        self.storage = storage_manager or DocumentStorageManager(storage_root=storage_root)
        self.chunker = TokenAwareChunker()
        self.max_upload_bytes = max_upload_bytes

    # ------------------------------------------------------------------ ingest

    def ingest_file(
        self,
        filename: str,
        data: bytes,
        tenant_id: str = "default",
        title: str | None = None,
    ) -> IngestResult:
        """Ingest raw bytes transactionally; duplicates return ``duplicate_of``."""
        if len(data) > self.max_upload_bytes:
            raise IngestionError(
                f"{filename} exceeds the {self.max_upload_bytes // (1024 * 1024)} MB upload limit"
            )
        digest = hashlib.sha256(data).hexdigest()
        existing = self.storage.find_duplicate(digest, tenant_id)
        if existing is not None:
            return IngestResult(
                filename=filename,
                status="duplicate",
                document_id=existing,
                duplicate_of=existing,
            )

        try:
            parsed = parse_file(filename, data, title=title)
        except Exception as error:
            raise IngestionError(f"Could not parse {filename}: {error}") from error
        doc_id = f"doc-{uuid.uuid4().hex[:12]}"
        source_format = str(parsed.format.value if hasattr(parsed.format, "value") else parsed.format)
        # Captured before persisting so the new document cannot shadow it.
        previous_id = self.storage.find_by_filename(filename, tenant_id)

        chunks = self.chunker.chunk_document(
            parsed, doc_id=doc_id, source=filename, source_format=source_format, tenant_id=tenant_id
        )
        injection_found = self._flag_possible_injection(chunks)
        try:
            entities, relations = self.graph_store.extract_and_store(doc_id, parsed.text, tenant_id=tenant_id, chunks=chunks)
            self._index_chunks(chunks, tenant_id=tenant_id)
            document = Document(
                id=doc_id,
                title=parsed.title,
                text=parsed.text,
                format=parsed.format,
                source=filename,
            )
            meta_record = self.storage.save_document(
                doc=document,
                chunks=chunks,
                entities=entities,
                relationships=relations,
                raw_bytes=data,
                tenant_id=tenant_id,
                content_hash=digest,
            )
            # Publish the final count before replacement. If publication fails,
            # the old version is still intact and the new one can be rolled back.
            self._replace_previous(doc_id, previous_id)
        except Exception as error:
            self._rollback(doc_id, tenant_id)
            if previous_id is not None:
                try:
                    self._publish_manifest()
                except Exception as manifest_error:  # noqa: BLE001 - preserve the ingest error
                    logger.error("Could not restore manifest after failed update: %s", manifest_error)
            raise IngestionError(f"Failed to ingest {filename}: {error}") from error
        warnings = [*parsed.warnings]
        if injection_found:
            warnings.append("Possible prompt injection detected in one or more chunks.")
        status = "indexed_with_warnings" if warnings else "indexed"
        return IngestResult(
            filename=filename,
            status=status,
            document_id=doc_id,
            format=source_format,
            pages=len(parsed.pages),
            chunks=len(chunks),
            warnings=warnings,
            entities_extracted=len(entities),
            relationships_extracted=len(relations),
            created_at=meta_record.get("created_at", ""),
        )

    def ingest_text(
        self,
        text: str,
        title: str,
        source: str = "manual",
        doc_format: DocumentFormat = DocumentFormat.MARKDOWN,
        persist: bool = True,
        tenant_id: str = "default",
    ) -> IngestResult:
        """Ingest decoded text through the same transactional path as files."""
        parsed = parse_text(text, doc_format, title=title)
        doc_id = f"doc-{uuid.uuid4().hex[:12]}"
        source_format = str(parsed.format.value if hasattr(parsed.format, "value") else parsed.format)
        # An explicit source is the identity; a manual document is known by
        # the name storage gives it (title and format), so ingesting it again
        # replaces the previous copy instead of piling up duplicates.
        stored_source = source if source != "manual" else f"{parsed.title}.{source_format}"
        # Captured before persisting so the new document cannot shadow it.
        previous_id = (
            self.storage.find_by_filename(stored_source, tenant_id) if persist else None
        )

        chunks = self.chunker.chunk_document(
            parsed,
            doc_id=doc_id,
            source=stored_source,
            source_format=source_format,
            tenant_id=tenant_id,
        )
        injection_found = self._flag_possible_injection(chunks)
        try:
            entities, relations = self.graph_store.extract_and_store(doc_id, parsed.text, tenant_id=tenant_id, chunks=chunks)
            self._index_chunks(chunks, tenant_id=tenant_id)
            created_at = ""
            if persist:
                document = Document(
                    id=doc_id,
                    title=parsed.title,
                    text=parsed.text,
                    format=parsed.format,
                    source=stored_source,
                )
                meta_record = self.storage.save_document(
                    doc=document,
                    chunks=chunks,
                    entities=entities,
                    relationships=relations,
                    tenant_id=tenant_id,
                    content_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
                )
                created_at = meta_record.get("created_at", "")
                self._replace_previous(doc_id, previous_id)
        except Exception as error:
            self._rollback(doc_id, tenant_id)
            if previous_id is not None:
                try:
                    self._publish_manifest()
                except Exception as manifest_error:  # noqa: BLE001 - preserve the ingest error
                    logger.error("Could not restore manifest after failed update: %s", manifest_error)
            raise IngestionError(f"Failed to ingest text {title!r}: {error}") from error

        return IngestResult(
            filename=stored_source,
            status="indexed_with_warnings" if parsed.warnings or injection_found else "indexed",
            document_id=doc_id,
            format=source_format,
            chunks=len(chunks),
            warnings=[
                *parsed.warnings,
                *(["Possible prompt injection detected in one or more chunks."] if injection_found else []),
            ],
            entities_extracted=len(entities),
            relationships_extracted=len(relations),
            created_at=created_at,
        )

    def _replace_previous(self, doc_id: str, previous_id: str | None) -> None:
        """Publish the manifest for the saved document, then drop the one it replaces."""
        if previous_id is not None and previous_id != doc_id:
            previous = self.storage.get_document(previous_id)
            previous_chunks = len(previous.get("chunks", [])) if previous else 0
            final_count = len(self.storage.load_all_chunks()) - previous_chunks
            self._publish_manifest(chunk_count=final_count)
            self._delete_document(previous_id, publish_manifest=False)
        else:
            self._publish_manifest()

    # ------------------------------------------------------------------ index

    @staticmethod
    def _flag_possible_injection(chunks: list[Chunk]) -> bool:
        found = False
        for chunk in chunks:
            if has_possible_prompt_injection(chunk.text):
                flags = list(chunk.metadata.get("flags", []))
                if "possible_injection" not in flags:
                    flags.append("possible_injection")
                chunk.metadata["flags"] = flags
                found = True
        return found

    def _index_chunks(self, chunks: list[Chunk], tenant_id: str = "default") -> int:
        if self.embedder is None:
            raise RuntimeError("Embedder must be initialized at startup or explicitly injected")
        for chunk in chunks:
            # Fresh ingest stamps the caller's tenant; hydration keeps the
            # tenant already recorded on each persisted chunk.
            chunk.metadata.setdefault("tenant_id", tenant_id)
        indexed = 0
        for start in range(0, len(chunks), EMBED_BATCH_SIZE):
            batch = chunks[start : start + EMBED_BATCH_SIZE]
            vectors = self.embedder.embed_passages([embedded_text(chunk) for chunk in batch])
            indexed += self.vector_store.upsert_chunks(batch, vectors)
        return indexed

    def _rollback(self, doc_id: str, tenant_id: str) -> None:
        """Undo every partial artifact of a failed ingest."""
        try:
            self.vector_store.delete_document(doc_id, tenant_id=tenant_id)
        except Exception as error:  # noqa: BLE001 - rollback must not mask the original failure
            logger.error("Rollback could not delete Qdrant points for %s: %s", doc_id, error)
        try:
            self.storage.remove_document_files(doc_id)
        except Exception as error:  # noqa: BLE001 - preserve the original ingestion failure
            logger.error("Rollback could not remove disk files for %s: %s", doc_id, error)
        if hasattr(self.graph_store, "delete_by_document"):
            try:
                self.graph_store.delete_by_document(doc_id, tenant_id=tenant_id)
            except Exception as error:  # noqa: BLE001 - preserve the original ingestion failure
                logger.error("Rollback could not remove graph data for %s: %s", doc_id, error)

    def _publish_manifest(self, chunk_count: int | None = None) -> None:
        """Record index provenance after every successful mutation of disk chunks.

        The manifest records the configuration the index was built under, so a
        changed model, dimension, or chunker version makes the next boot refuse
        queries until scripts/reindex.py rebuilds the index.
        """
        from datetime import UTC, datetime

        from packages.core.settings import get_settings

        settings = get_settings()
        write_manifest(
            self.storage.root_dir,
            IndexManifest(
                embedding_model=settings.embedding_model,
                embedding_dim=settings.qdrant_vector_dim,
                chunker_version=CHUNKER_VERSION,
                created_at=datetime.now(UTC).isoformat(),
                chunk_count=(
                    len(self.storage.load_all_chunks()) if chunk_count is None else chunk_count
                ),
            ),
        )

    def load_persisted_knowledge_base(self) -> int:
        """Hydrates the vector store from disk chunk records on startup."""
        all_chunks = self.storage.load_all_chunks()
        if all_chunks:
            self._index_chunks(all_chunks)
            total_chunks = len(all_chunks)
            logger.info(
                "Hydrated %d documents (%d chunks) from dedicated storage.",
                len(self.storage.list_documents()),
                total_chunks,
            )
            return len(self.storage.list_documents())
        logger.info("Hydrated %d documents from dedicated storage.", len(self.storage.list_documents()))
        return len(self.storage.list_documents())

    # ------------------------------------------------------------------ manage

    def get_documents(self, tenant_id: str | None = None) -> list[dict[str, Any]]:
        """Returns document summaries from dedicated storage for UI display."""
        return self.storage.list_documents(tenant_id=tenant_id)

    def get_document(self, doc_id: str, tenant_id: str | None = None) -> dict[str, Any] | None:
        """Retrieves full document record with chunks from storage."""
        return self.storage.get_document(doc_id, tenant_id=tenant_id)

    def delete_document(self, doc_id: str, tenant_id: str | None = None) -> bool:
        """Permanently removes a document from disk, Qdrant, and the graph."""
        return self._delete_document(doc_id, publish_manifest=True, tenant_id=tenant_id)

    def _delete_document(
        self, doc_id: str, *, publish_manifest: bool, tenant_id: str | None = None
    ) -> bool:
        doc = self.storage.get_document(doc_id, tenant_id=tenant_id)
        if doc is None:
            return False
        tenant_id = str(doc.get("tenant_id", "default"))
        chunks = self.storage.get_document_chunks(doc_id)
        disk_snapshot: list[tuple[Path, bytes]] = []
        original_path = (
            Path(doc["original_path"])
            if doc.get("original_path")
            else self.storage.docs_dir / str(doc["filename"])
            if doc.get("filename")
            else None
        )
        for path in (
            self.storage.meta_dir / f"{doc_id}.json",
            self.storage.chunks_dir / f"{doc_id}.json",
            original_path,
        ):
            if path is not None and path.exists():
                disk_snapshot.append((path, path.read_bytes()))
        graph_snapshot = {
            name: deepcopy(getattr(self.graph_store, name))
            for name in (
                "entities",
                "relationships",
                "_doc_entities",
                "_doc_relationships",
                "_entity_names_lower",
                "_tenant_entities",
                "_tenant_relationships",
                "_tenant_doc_entities",
                "_tenant_doc_relationships",
                "_tenant_doc_chunks",
            )
            if hasattr(self.graph_store, name)
        }
        try:
            if publish_manifest:
                remaining_count = len(self.storage.load_all_chunks()) - len(doc.get("chunks", []))
                self._publish_manifest(chunk_count=remaining_count)
            # Keep the catalog and original available if Qdrant rejects deletion.
            self.vector_store.delete_document(doc_id, tenant_id=tenant_id)
            if not self.storage.delete_document(doc_id, tenant_id=tenant_id):
                raise OSError(f"Disk records for {doc_id} disappeared during deletion")
            if hasattr(self.graph_store, "delete_by_document"):
                self.graph_store.delete_by_document(doc_id, tenant_id=tenant_id or str(doc.get("tenant_id", "default")))
        except Exception as error:
            for path, contents in disk_snapshot:
                try:
                    atomic_write_bytes(path, contents)
                except Exception as restore_error:  # noqa: BLE001 - preserve the delete error
                    logger.error("Could not restore disk file %s: %s", path, restore_error)
            for name, value in graph_snapshot.items():
                setattr(self.graph_store, name, value)
            if chunks:
                try:
                    self._index_chunks(chunks, tenant_id=tenant_id)
                except Exception as restore_error:  # noqa: BLE001 - preserve the delete error
                    logger.error("Could not restore Qdrant points for %s: %s", doc_id, restore_error)
            if publish_manifest:
                try:
                    self._publish_manifest()
                except Exception as manifest_error:  # noqa: BLE001 - preserve the delete error
                    logger.error("Could not restore manifest after failed delete: %s", manifest_error)
            raise IngestionError(f"Failed to delete document {doc_id}: {error}") from error
        return True

    def clear_all(self) -> int:
        """Removes all documents, chunks, and metadata files from dedicated storage."""
        count = self.storage.clear_all()
        self.vector_store.clear(tenant_id=None)
        if hasattr(self.graph_store, "clear_all_graph"):
            self.graph_store.clear_all_graph()
        else:
            self.graph_store.entities.clear()
            self.graph_store.relationships.clear()
        self._publish_manifest()
        return count

    def reindex_all(self) -> IndexManifest:
        """Rebuild Qdrant from disk chunk records, verifying counts before publishing."""
        if self.embedder is None:
            raise IngestionError("Embedder must be initialized before reindexing")
        from packages.core.settings import get_settings
        from scripts.reindex import reindex

        settings = get_settings()
        if (
            settings.qdrant_collection != self.vector_store.collection_name
            or settings.qdrant_vector_dim != self.vector_store.dim
        ):
            raise IngestionError("Configured Qdrant collection does not match the active vector store")
        return reindex(self.storage, self.vector_store.client, settings, self.embedder)
