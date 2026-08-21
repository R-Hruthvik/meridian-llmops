"""Unified Ingestion Pipeline executing parsing, structural chunking, dual-memory indexing, and dedicated storage."""

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger("meridian.ingestion.pipeline")

from packages.core.models import Document, DocumentFormat
from services.ingestion.chunker import StructuralChunker
from services.ingestion.graph_store import KnowledgeGraphStore
from services.ingestion.parsers import parse_document
from services.ingestion.storage import DocumentStorageManager
from services.ingestion.vector_store import VectorStoreManager


class IngestionPipeline:
    """Coordinates parsing, structural chunking, dedicated storage, Qdrant vector indexing, and Neo4j graph extraction."""

    def __init__(
        self,
        vector_store: VectorStoreManager | None = None,
        graph_store: KnowledgeGraphStore | None = None,
        storage_manager: DocumentStorageManager | None = None,
        in_memory: bool = True,
        storage_root: Path | str | None = None,
    ):
        self.vector_store = vector_store or VectorStoreManager(in_memory=in_memory)
        self.graph_store = graph_store or KnowledgeGraphStore(in_memory=in_memory)
        self.storage = storage_manager or DocumentStorageManager(storage_root=storage_root)
        self.chunker = StructuralChunker()

    def load_persisted_knowledge_base(self) -> int:
        """Hydrates vector store and knowledge graph from dedicated disk storage on startup."""
        # Perf: prefer single-pass load_all_chunks to avoid N*2 file IO; doc_id→chunk_ids index hint
        all_chunks = self.storage.load_all_chunks()
        if all_chunks:
            self.vector_store.index_chunks(all_chunks)
            total_chunks = len(all_chunks)
            # Still need per-doc text for graph reconstruction (single scan of metadata)
            for meta in self.storage.list_documents():
                doc_id = meta["id"]
                full_doc = self.storage.get_document(doc_id)
                if full_doc and full_doc.get("text"):
                    self.graph_store.extract_and_store(doc_id, full_doc["text"])
            logger.info("Hydrated %d documents (%d chunks) from dedicated storage.", len(self.storage.list_documents()), total_chunks)
            return len(self.storage.list_documents())
        # Fallback: legacy per-document loading if load_all_chunks empty but docs exist
        stored_docs = self.storage.list_documents()
        total_chunks = 0
        for meta in stored_docs:
            doc_id = meta["id"]
            chunks = self.storage.get_document_chunks(doc_id)
            if chunks:
                self.vector_store.index_chunks(chunks)
                total_chunks += len(chunks)
            full_doc = self.storage.get_document(doc_id)
            if full_doc and full_doc.get("text"):
                self.graph_store.extract_and_store(doc_id, full_doc["text"])
        logger.info("Hydrated %d documents (%d chunks) from dedicated storage.", len(stored_docs), total_chunks)
        return len(stored_docs)

    def ingest_text(
        self,
        text: str,
        title: str,
        doc_format: DocumentFormat = DocumentFormat.MARKDOWN,
        source: str = "manual",
        persist: bool = True,
    ) -> dict[str, Any]:
        doc = parse_document(
            content=text,
            title=title,
            doc_format=doc_format,
            source=source,
        )
        return self.ingest_document(doc, persist=persist)

    def ingest_document(self, doc: Document, persist: bool = True) -> dict[str, Any]:
        chunks = self.chunker.chunk(doc)
        indexed_count = self.vector_store.index_chunks(chunks)
        entities, relations = self.graph_store.extract_and_store(doc.id, doc.text)

        meta_record = {}
        if persist:
            meta_record = self.storage.save_document(
                doc=doc,
                chunks=chunks,
                entities=entities,
                relationships=relations,
            )

        return {
            "document_id": doc.id,
            "title": doc.title,
            "filename": meta_record.get("filename", f"{doc.id}.{doc.format}"),
            "chunks_indexed": indexed_count,
            "entities_extracted": len(entities),
            "relationships_extracted": len(relations),
            "created_at": meta_record.get("created_at", ""),
        }

    def get_documents(self) -> list[dict[str, Any]]:
        """Returns document summaries from dedicated storage for UI display."""
        return self.storage.list_documents()

    def get_document(self, doc_id: str) -> dict[str, Any] | None:
        """Retrieves full document record with chunks from storage."""
        return self.storage.get_document(doc_id)

    def delete_document(self, doc_id: str) -> bool:
        """Permanently removes document, raw files, and chunks from storage, vector and graph memory."""
        deleted = self.storage.delete_document(doc_id)
        if deleted:
            self.vector_store.delete_chunks_by_document(doc_id)
            # Graph cleanup: prefer dedicated method, fallback to manual filter
            if hasattr(self.graph_store, "delete_by_document"):
                self.graph_store.delete_by_document(doc_id)
            else:
                self.graph_store.entities = {
                    k: v for k, v in self.graph_store.entities.items() if getattr(v, "doc_id", None) != doc_id
                }
                self.graph_store.relationships = [
                    r for r in self.graph_store.relationships if getattr(r, "doc_id", None) != doc_id
                ]
        return deleted

    def clear_all(self) -> int:
        """Removes all documents and chunks from storage and active memory."""
        count = self.storage.clear_all()
        self.vector_store.clear()
        if hasattr(self.graph_store, "clear_all_graph"):
            self.graph_store.clear_all_graph()
        else:
            self.graph_store.entities.clear()
            self.graph_store.relationships.clear()
        return count
