"""Tests for core domain models and configuration."""

from packages.core.config import get_settings
from packages.core.models import (
    Chunk,
    CriticVerdict,
    Document,
    DocumentFormat,
    Entity,
    QueryRequest,
    QueryResponse,
    Relationship,
    SearchResult,
)


def test_document_creation():
    doc = Document(
        id="doc-1",
        title="Enterprise Architecture Guide",
        text="Sample document text",
        format=DocumentFormat.MARKDOWN,
        source="docs/architecture.md",
        metadata={"author": "Team"},
    )
    assert doc.id == "doc-1"
    assert doc.format == DocumentFormat.MARKDOWN
    assert doc.title == "Enterprise Architecture Guide"


def test_chunk_and_embedding():
    chunk = Chunk(
        id="chunk-1",
        document_id="doc-1",
        text="Section 1 content",
        chunk_index=0,
        section_heading="Overview",
        embedding=[0.1, 0.2, 0.3],
    )
    assert chunk.section_heading == "Overview"
    assert len(chunk.embedding) == 3


def test_graph_entities_and_relationships():
    entity_a = Entity(name="LiteLLM", entity_type="Gateway", properties={"version": "1.35"})
    entity_b = Entity(name="FastAPI", entity_type="Framework", properties={"async": True})
    assert entity_a.name == "LiteLLM"
    assert entity_b.name == "FastAPI"
    rel = Relationship(
        source_entity="FastAPI",
        target_entity="LiteLLM",
        relation_type="ROUTES_TO",
        properties={"protocol": "HTTP"},
    )
    assert rel.source_entity == "FastAPI"
    assert rel.relation_type == "ROUTES_TO"


def test_query_request_and_response():
    req = QueryRequest(query="What is the gateway architecture?", top_k=5, max_cycles=3)
    assert req.top_k == 5
    assert req.max_cycles == 3

    resp = QueryResponse(
        query=req.query,
        answer="The gateway uses LiteLLM proxy containers.",
        source_chunks=[
            SearchResult(
                chunk_id="c1",
                document_id="d1",
                text="Gateway docs",
                score=0.95,
                retrieval_method="hybrid_rrf",
            )
        ],
        cycle_count=1,
        verified=True,
    )
    assert resp.verified is True
    assert len(resp.source_chunks) == 1


def test_critic_verdict():
    verdict = CriticVerdict(
        is_grounded=True,
        confidence_score=0.98,
        unsupported_claims=[],
        reasoning="All factual assertions found in source chunks.",
    )
    assert verdict.is_grounded is True
    assert verdict.confidence_score == 0.98


def test_settings():
    settings = get_settings()
    assert settings.api_port == 8000
    assert settings.qdrant_collection == "meridian_documents"
