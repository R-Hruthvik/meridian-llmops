"""TDD Tests for Structural Ingestion and Dual-Memory Storage (Qdrant + Neo4j)."""

from packages.core.models import Document, DocumentFormat
from services.ingestion.chunker import StructuralChunker
from services.ingestion.graph_store import KnowledgeGraphStore
from services.ingestion.parsers import parse_document
from services.ingestion.pipeline import IngestionPipeline
from services.ingestion.vector_store import VectorStoreManager


def test_markdown_parser_and_structural_chunking():
    md_content = """# System Overview
This is the main introduction to the Meridian architecture.

## AI Gateway
The AI Gateway intercepts requests, enforces token rate limits, and blocks prompt injections.

## Knowledge Graph
Neo4j stores entity relationships and dependencies between components.
"""
    doc = parse_document(
        content=md_content,
        title="Architecture",
        doc_format=DocumentFormat.MARKDOWN,
        source="architecture.md",
    )
    assert doc.title == "Architecture"
    assert doc.format == DocumentFormat.MARKDOWN

    chunker = StructuralChunker(max_chunk_size=300)
    chunks = chunker.chunk(doc)

    assert len(chunks) >= 3
    headings = [c.section_heading for c in chunks]
    assert "System Overview" in headings
    assert "AI Gateway" in headings
    assert "Knowledge Graph" in headings


def test_html_parser():
    html_content = """
    <html>
        <body>
            <h1>Deployment Guide</h1>
            <p>Deploy using Docker Compose with Qdrant and Neo4j.</p>
        </body>
    </html>
    """
    doc = parse_document(
        content=html_content,
        title="Deploy Guide",
        doc_format=DocumentFormat.HTML,
        source="deploy.html",
    )
    assert "Deployment Guide" in doc.text
    assert "<html" not in doc.text


def test_vector_store_in_memory_or_qdrant():
    vstore = VectorStoreManager(in_memory=True)
    doc = Document(
        id="doc-test-1",
        title="RAG Guide",
        text="Dense vectors enable semantic retrieval.",
        source="guide.txt",
    )
    chunker = StructuralChunker()
    chunks = chunker.chunk(doc)
    vstore.index_chunks(chunks)

    results = vstore.search("semantic retrieval", top_k=2)
    assert len(results) > 0
    assert results[0].document_id == "doc-test-1"
    assert "semantic retrieval" in results[0].text


def test_knowledge_graph_extraction_and_storage():
    gstore = KnowledgeGraphStore(in_memory=True)
    text = "FastAPI service routes requests to LiteLLM Gateway. LiteLLM Gateway connects to OpenAI."
    entities, relationships = gstore.extract_and_store(doc_id="doc-test-1", text=text)

    entity_names = [e.name for e in entities]
    assert "FastAPI" in entity_names or "Fastapi" in entity_names or len(entities) >= 2
    assert len(relationships) >= 1


def test_full_ingestion_pipeline():
    pipeline = IngestionPipeline(in_memory=True)
    sample_text = """# Meridian Self-Healing RAG
Meridian RAG uses LangGraph cyclic orchestration.
The Critic Agent checks whether answers are grounded in Qdrant and Neo4j.
"""
    result = pipeline.ingest_text(
        text=sample_text,
        title="Self-Healing RAG",
        doc_format=DocumentFormat.MARKDOWN,
        source="spec.md",
    )
    assert result["document_id"] is not None
    assert result["chunks_indexed"] >= 1
    assert result["entities_extracted"] >= 1
