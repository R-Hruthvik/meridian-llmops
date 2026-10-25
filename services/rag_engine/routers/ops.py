"""Operations router: health probes, metrics, and index inspection/rebuild.

Split out of :mod:`services.rag_engine.routers.api`. Shared service singletons
are resolved through the aggregation module at call time via :class:`LiveRef`,
so the test suite's monkeypatches on ``routers.api`` keep taking effect.
"""

import asyncio

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from packages.core.models import IndexStatusResponse
from services.ingestion.manifest import check_consistency
from services.rag_engine.deps import require_admin, require_user
from services.rag_engine.index_inspector import build_index_status
from services.rag_engine.routers._state import (
    graph_store_ref,
    ingestion_pipeline_ref,
    retriever_ref,
    tracer_ref,
    vector_store_ref,
)

router = APIRouter()

# Resolve shared services through the aggregation module at call time so tests
# that rebind ``routers.api.<name>`` are honoured.
vector_store = vector_store_ref
graph_store = graph_store_ref
ingestion_pipeline = ingestion_pipeline_ref
retriever = retriever_ref
tracer = tracer_ref


@router.get("/health/live")
async def health_live():
    """Process liveness: the app is up and serving."""
    return {"alive": True}


@router.get("/health/ready")
async def health_ready(request: Request):
    """Return only the serving-readiness bit needed by external probes."""
    qdrant_health = await asyncio.to_thread(vector_store.health)
    consistency = getattr(request.app.state, "index_consistency", None)
    index_ok = consistency.ok if consistency is not None else False
    embedder = ingestion_pipeline.embedder
    ready = qdrant_health["status"] == "ready" and index_ok and embedder is not None
    return {"ready": ready}


async def _count_vector_chunks(store, tenant_id: str) -> int:
    try:
        return await asyncio.to_thread(store.count, tenant_id=tenant_id)
    except Exception:  # noqa: BLE001
        return 0


@router.get("/health")
async def health_check(
    request: Request,
    x_api_key: str | None = Header(None, alias="X-API-Key"),
    x_tenant_id: str | None = Header(None, alias="X-Tenant-Id"),
):
    response = {"status": "healthy", "service": "meridian-rag-engine"}
    if x_api_key is None:
        return response

    tenant_id = await require_user(x_api_key=x_api_key, x_tenant_id=x_tenant_id)
    return {
        **response,
        # Live count, same source as /v1/documents - a boot-time snapshot went stale on ingest.
        "storage_documents": len(await asyncio.to_thread(ingestion_pipeline.get_documents, tenant_id=tenant_id)),
        "vector_chunks": await _count_vector_chunks(vector_store, tenant_id=tenant_id),
        "services": request.app.state.service_status,
    }


@router.get("/v1/metrics")
async def get_metrics(tenant_id: str = Depends(require_admin)):
    """Returns aggregated token usage and cost metrics."""
    return tracer.get_tenant_metrics(tenant_id)


@router.get("/v1/index/status", response_model=IndexStatusResponse)
async def get_index_status(tenant_id: str = Depends(require_admin)):
    """Inspects the live index and storage state behind every subsystem.

    Always answers 200 (given valid auth) - a down backend is reported as a
    degraded fallback, because describing degraded state is the point.
    """
    # Same session factory the rest of the platform uses; no new client is built.
    from packages.core.db import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        return await build_index_status(
            vector_store=vector_store,
            graph_store=graph_store,
            retriever=retriever,
            db=db,
        )


@router.post("/v1/reindex")
async def reindex_endpoint(request: Request, tenant_id: str = Depends(require_admin)):
    """Rebuilds the vector index from disk chunk records (stop ingestion first)."""
    try:
        manifest = await asyncio.to_thread(ingestion_pipeline.reindex_all)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Reindex failed: {error}") from error
    disk_chunks = len(ingestion_pipeline.storage.load_all_chunks())
    request.app.state.index_consistency = await asyncio.to_thread(
        check_consistency, request.app.state.settings, await asyncio.to_thread(vector_store.count), disk_chunks
    )
    if getattr(request.app.state, "use_legacy_services", False):
        # Legacy singleton mirror lives on the aggregation module.
        from services.rag_engine.routers import api as _api

        _api._index_consistency = request.app.state.index_consistency
    retriever.update_chunks(vector_store.get_all_chunks(None))
    return {
        "status": "reindexed",
        "chunk_count": manifest.chunk_count,
        "embedding_model": manifest.embedding_model,
        "consistent": request.app.state.index_consistency.ok,
    }
