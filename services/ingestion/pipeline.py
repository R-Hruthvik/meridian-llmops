"""Unified Ingestion Pipeline executing parsing, structural chunking, and dual-memory indexing."""

from typing import Any

from packages.core.models import Document, DocumentFormat
from services.ingestion.chunker import StructuralChunker
from services.ingestion.graph_store import KnowledgeGraphStore
from services.ingestion.parsers import parse_document
from services.ingestion.vector_store import VectorStoreManager


class IngestionPipeline:
    """Coordinates parsing, structural chunking, Qdrant vector indexing, and Neo4j graph extraction."""

    def __init__(
        self,
        vector_store: VectorStoreManager | None = None,
        graph_store: KnowledgeGraphStore | None = None,
        in_memory: bool = True,
    ):
        self.vector_store = vector_store or VectorStoreManager(in_memory=in_memory)
        self.graph_store = graph_store or KnowledgeGraphStore(in_memory=in_memory)
        self.chunker = StructuralChunker()

    def ingest_text(
        self,
        text: str,
        title: str,
        doc_format: DocumentFormat = DocumentFormat.MARKDOWN,
        source: str = "manual",
    ) -> dict[str, Any]:
        doc = parse_document(
            content=text,
            title=title,
            doc_format=doc_format,
            source=source,
        )
        return self.ingest_document(doc)

    def ingest_document(self, doc: Document) -> dict[str, Any]:
        chunks = self.chunker.chunk(doc)
        indexed_count = self.vector_store.index_chunks(chunks)
        entities, relations = self.graph_store.extract_and_store(doc.id, doc.text)

        return {
            "document_id": doc.id,
            "title": doc.title,
            "chunks_indexed": indexed_count,
            "entities_extracted": len(entities),
            "relationships_extracted": len(relations),
        }
