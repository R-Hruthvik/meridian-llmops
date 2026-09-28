"""Live Index & Storage inspection for the operations dashboard.

Every number here is read from a real query against the subsystem the app is
already wired to. A backend that is down is reported as degraded, never faked,
and this module never raises: describing degraded state is the whole job.
"""

import logging
from typing import Any

from sqlalchemy import inspect, text

from packages.core.config import get_settings
from packages.core.models import (
    BackendHealth,
    GraphIndexStatus,
    IndexStatusResponse,
    LexicalIndexStatus,
    RelationalIndexStatus,
    TableRowCount,
    VectorIndexStatus,
)

logger = logging.getLogger("meridian.rag_engine.index_inspector")


def _safe_attr(obj: Any, name: str, default: Any = None) -> Any:
    """Reads an attribute that may be absent, or may raise if the backend is dead."""
    try:
        return getattr(obj, name)
    except Exception as e:  # noqa: BLE001 - a broken backend must not break inspection
        logger.debug("Index inspection could not read %s: %s", name, e)
        return default


def _vector_endpoint() -> str:
    s = get_settings()
    return f"http://{s.qdrant_host}:{s.qdrant_port}"


def _graph_endpoint() -> str:
    return get_settings().neo4j_uri


def _read_vector(vector_store: Any) -> tuple[VectorIndexStatus, BackendHealth]:
    """Reads Qdrant collections and point counts; falls back to the in-process cache."""
    endpoint = _vector_endpoint()
    client = _safe_attr(vector_store, "client")
    live = client is not None and not _safe_attr(vector_store, "is_fallback", False)

    if not live:
        cached = _safe_attr(vector_store, "get_all_chunks")
        try:
            total = len(cached()) if callable(cached) else None
        except Exception as e:  # noqa: BLE001
            logger.debug("In-memory chunk count unavailable: %s", e)
            total = None
        return (
            VectorIndexStatus(
                collections=[],
                points_per_collection={},
                total_points=total,
                vector_dimension=_safe_attr(vector_store, "dim"),
                is_fallback=True,
                detail=(
                    "No live Qdrant client in use; collections are not reported. "
                    f"total_points is the in-process fallback cache ({total} chunks), not persisted state."
                ),
            ),
            BackendHealth(
                reachable=False,
                is_fallback=True,
                endpoint=endpoint,
                detail="Qdrant unreachable or not in use - serving the in-memory vector fallback.",
            ),
        )

    try:
        collection_names = [
            getattr(c, "name", str(c)) for c in client.get_collections().collections
        ]
        points = {
            name: int(client.count(collection_name=name, exact=True).count)
            for name in collection_names
        }
        dimension = _safe_attr(vector_store, "dim")
        return (
            VectorIndexStatus(
                collections=collection_names,
                points_per_collection=points,
                total_points=sum(points.values()),
                vector_dimension=dimension,
                is_fallback=False,
                detail=f"Read live from Qdrant ({len(collection_names)} collections).",
            ),
            BackendHealth(
                reachable=True,
                is_fallback=False,
                endpoint=endpoint,
                detail="Qdrant answered a live collections query.",
            ),
        )
    except Exception as e:  # noqa: BLE001 - degraded reporting beats a 500
        logger.warning("Qdrant live inspection failed: %s", e)
        return (
            VectorIndexStatus(
                collections=[], points_per_collection={}, is_fallback=True,
                detail=f"Qdrant query failed, so no collection data is reported: {e}",
            ),
            BackendHealth(
                reachable=False, is_fallback=True, endpoint=endpoint,
                detail=f"Qdrant query failed: {e}",
            ),
        )


def _read_graph(graph_store: Any) -> tuple[GraphIndexStatus, BackendHealth]:
    """Reads Neo4j node/relationship counts; falls back to the in-process graph."""
    endpoint = _graph_endpoint()
    driver = _safe_attr(graph_store, "driver")
    live = driver is not None and not _safe_attr(graph_store, "is_fallback", False)

    if not live:
        entities = _safe_attr(graph_store, "entities")
        relationships = _safe_attr(graph_store, "relationships")
        node_count = len(entities) if isinstance(entities, dict) else None
        rel_count = len(relationships) if isinstance(relationships, list) else None
        return (
            GraphIndexStatus(
                node_count=node_count,
                relationship_count=rel_count,
                entity_index_size=node_count,
                is_fallback=True,
                detail=(
                    "No live Neo4j driver in use; counts are the in-process fallback graph, "
                    "not persisted state."
                ),
            ),
            BackendHealth(
                reachable=False,
                is_fallback=True,
                endpoint=endpoint,
                detail="Neo4j unreachable or not in use - serving the in-memory graph fallback.",
            ),
        )

    try:
        with driver.session() as session:
            node_count = int(session.run("MATCH (n) RETURN count(n) AS c").single()["c"])
            rel_count = int(
                session.run("MATCH ()-[r]->() RETURN count(r) AS c").single()["c"]
            )
        return (
            GraphIndexStatus(
                node_count=node_count,
                relationship_count=rel_count,
                entity_index_size=node_count,
                is_fallback=False,
                detail="Read live from Neo4j.",
            ),
            BackendHealth(
                reachable=True,
                is_fallback=False,
                endpoint=endpoint,
                detail="Neo4j answered live count queries.",
            ),
        )
    except Exception as e:  # noqa: BLE001 - degraded reporting beats a 500
        logger.warning("Neo4j live inspection failed: %s", e)
        return (
            GraphIndexStatus(
                node_count=None, relationship_count=None, entity_index_size=None,
                is_fallback=True, detail=f"Neo4j query failed, so no counts are reported: {e}",
            ),
            BackendHealth(
                reachable=False, is_fallback=True, endpoint=endpoint,
                detail=f"Neo4j query failed: {e}",
            ),
        )


def _read_lexical(retriever: Any) -> tuple[LexicalIndexStatus, BackendHealth]:
    """Reads the BM25 corpus size straight off the live retriever."""
    endpoint = "in-process"
    bm25 = _safe_attr(retriever, "bm25_index")
    chunks = _safe_attr(bm25, "chunks") if bm25 is not None else None

    if not isinstance(chunks, list):
        return (
            LexicalIndexStatus(
                corpus_size=None, document_count=None, is_fallback=True,
                detail="BM25 index is not readable from the retriever.",
            ),
            BackendHealth(
                reachable=False, is_fallback=True, endpoint=endpoint,
                detail="No BM25 index present on the retriever.",
            ),
        )

    doc_ids = {c.document_id for c in chunks if hasattr(c, "document_id")}
    return (
        LexicalIndexStatus(
            corpus_size=len(chunks),
            document_count=len(doc_ids),
            is_fallback=False,
            detail=f"Read live from the BM25 index ({len(chunks)} chunks, {len(doc_ids)} documents).",
        ),
        BackendHealth(
            reachable=True,
            is_fallback=False,
            endpoint=endpoint,
            detail="BM25 index is in-process; it has no external service dependency.",
        ),
    )


async def _read_relational(db: Any) -> tuple[RelationalIndexStatus, BackendHealth]:
    """Introspects live table names and counts each with SELECT COUNT(*)."""
    endpoint = "unavailable"
    try:
        conn = await db.connection()
        endpoint = await conn.run_sync(
            lambda sync_conn: sync_conn.engine.url.render_as_string(hide_password=True)
        )
        table_names = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
        dialect = await conn.run_sync(lambda sync_conn: sync_conn.dialect.name)

        tables: list[TableRowCount] = []
        for name in sorted(table_names):
            result = await db.execute(text(f'SELECT COUNT(*) AS c FROM "{name}"'))
            tables.append(TableRowCount(name=name, row_count=int(result.scalar() or 0)))

        return (
            RelationalIndexStatus(
                dialect=dialect,
                tables=tables,
                total_rows=sum(t.row_count for t in tables),
                is_fallback=False,
                detail=f"Read live from {dialect}: {len(tables)} tables introspected and counted.",
            ),
            BackendHealth(
                reachable=True,
                is_fallback=False,
                endpoint=endpoint,
                detail="Relational store answered live introspection and count queries.",
            ),
        )
    except Exception as e:  # noqa: BLE001 - degraded reporting beats a 500
        logger.warning("Relational live inspection failed: %s", e)
        return (
            RelationalIndexStatus(
                dialect=None, tables=[], total_rows=0, is_fallback=True,
                detail=f"Relational store unreachable, so no tables are reported: {e}",
            ),
            BackendHealth(
                reachable=False, is_fallback=True, endpoint=endpoint,
                detail=f"Relational store unreachable: {e}",
            ),
        )


async def build_index_status(
    *,
    vector_store: Any,
    graph_store: Any,
    retriever: Any,
    db: Any,
) -> IndexStatusResponse:
    """Inspects every storage subsystem using the app's existing wiring.

    Returns a fully populated response even when every backend is down; each
    section is read independently so one failure cannot blank out the rest.
    """
    vector, vector_health = _read_vector(vector_store)
    graph, graph_health = _read_graph(graph_store)
    lexical, lexical_health = _read_lexical(retriever)
    relational, relational_health = await _read_relational(db)

    return IndexStatusResponse(
        vector=vector,
        graph=graph,
        lexical=lexical,
        relational=relational,
        backends={
            "vector": vector_health,
            "graph": graph_health,
            "lexical": lexical_health,
            "relational": relational_health,
        },
    )
