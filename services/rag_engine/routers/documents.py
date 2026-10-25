"""Document management router: upload, ingest, catalog, and deletion.

Split out of :mod:`services.rag_engine.routers.api`. Shared service singletons
are resolved through the aggregation module at call time via :class:`LiveRef`,
so the test suite's monkeypatches on ``routers.api`` keep taking effect.
"""

import asyncio
import logging
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile

from packages.core.errors import IndexReadError, IndexWriteError, IngestionError
from packages.core.models import DocumentFormat, IngestDocumentRequest
from services.ingestion.manifest import check_consistency
from services.rag_engine.deps import require_admin, require_user
from services.rag_engine.routers._state import (
    ingestion_pipeline_ref,
    retriever_ref,
    vector_store_ref,
)

logger = logging.getLogger("meridian.rag_engine.documents")

router = APIRouter()

# Resolve shared services through the aggregation module at call time so tests
# that rebind ``routers.api.<name>`` are honoured.
vector_store = vector_store_ref
ingestion_pipeline = ingestion_pipeline_ref
retriever = retriever_ref


@router.post("/v1/documents")
async def upload_documents_endpoint(
    files: Annotated[list[UploadFile], File()],
    request: Request,
    tenant_id: str = Depends(require_user),
):
    """Multipart upload (field ``files``, repeatable); one result row per file.

    Rejected files (bad type, oversized, unparseable) do not fail the whole
    request: their row carries ``status: rejected`` with the reason.
    """
    results: list[dict[str, Any]] = []
    for upload in files:
        filename = upload.filename or "upload"
        try:
            data = bytearray()
            limit = ingestion_pipeline.max_upload_bytes
            while block := await upload.read(min(64 * 1024, limit + 1 - len(data))):
                data.extend(block)
                if len(data) > limit:
                    raise IngestionError(f"{filename} exceeds the {limit / (1024 * 1024):g} MB upload limit")
            result = await asyncio.to_thread(ingestion_pipeline.ingest_file, filename, bytes(data), tenant_id=tenant_id)
            results.append(result.to_dict())
        except IngestionError as error:
            results.append(
                {
                    "filename": filename,
                    "status": "rejected",
                    "document_id": None,
                    "format": None,
                    "pages": 0,
                    "chunks": 0,
                    "warnings": [],
                    "duplicate_of": None,
                    "error": str(error),
                }
            )
    retriever.update_chunks(vector_store.get_all_chunks(None))
    try:
        settings = request.app.state.settings
        disk_chunks = len(ingestion_pipeline.storage.load_all_chunks())
        qdrant_points = vector_store.count()
        request.app.state.index_consistency = check_consistency(settings, qdrant_points, disk_chunks)
        import services.rag_engine.routers.api as _api
        _api._index_consistency = request.app.state.index_consistency
    except Exception as error:  # noqa: BLE001
        logger.warning("Index consistency refresh failed: %s", error)
    return {"results": results}


@router.post("/v1/ingest")
async def ingest_document_endpoint(
    payload: IngestDocumentRequest,
    request: Request,
    tenant_id: str = Depends(require_user),
):
    """Ingests text into dedicated disk storage, the Qdrant vector store, and the graph."""
    try:
        result = await asyncio.to_thread(
            ingestion_pipeline.ingest_text,
            text=payload.text,
            title=payload.title or "Uploaded Document",
            source=payload.filename or payload.source or "manual",
            doc_format=DocumentFormat(payload.format) if payload.format else DocumentFormat.MARKDOWN,
            tenant_id=tenant_id,
            metadata=payload.metadata,
        )
    except IngestionError as error:
        cause = error.__cause__
        if isinstance(cause, (IndexWriteError, IndexReadError)):
            # A typed index failure must reach the caller with its own code.
            raise cause from None
        raise HTTPException(status_code=400, detail=str(error)) from error
    retriever.update_chunks(vector_store.get_all_chunks(None))
    try:
        settings = request.app.state.settings
        disk_chunks = len(ingestion_pipeline.storage.load_all_chunks())
        qdrant_points = vector_store.count()
        request.app.state.index_consistency = check_consistency(settings, qdrant_points, disk_chunks)
        import services.rag_engine.routers.api as _api
        _api._index_consistency = request.app.state.index_consistency
    except Exception as error:  # noqa: BLE001
        logger.warning("Index consistency refresh failed: %s", error)
    return {
        **result.to_dict(),
        "title": payload.title or "Uploaded Document",
        "chunks_indexed": result.chunks,
    }


@router.delete("/v1/documents")
async def clear_all_documents_endpoint(request: Request, tenant_id: str = Depends(require_admin)):
    """Clears all documents and chunks from dedicated storage and active memory."""
    count = await asyncio.to_thread(ingestion_pipeline.clear_all, tenant_id=tenant_id)
    retriever.update_chunks(vector_store.get_all_chunks(None))
    try:
        settings = request.app.state.settings
        disk_chunks = len(ingestion_pipeline.storage.load_all_chunks())
        qdrant_points = vector_store.count()
        request.app.state.index_consistency = check_consistency(settings, qdrant_points, disk_chunks)
        import services.rag_engine.routers.api as _api
        _api._index_consistency = request.app.state.index_consistency
    except Exception as error:  # noqa: BLE001
        logger.warning("Index consistency refresh failed: %s", error)
    return {"status": "cleared", "deleted_count": count, "message": f"All {count} documents removed from storage"}


@router.post("/v1/documents/seed-samples")
async def seed_sample_documents_endpoint(request: Request, tenant_id: str = Depends(require_admin)):
    """Seeds or resets the default sample documentation into the knowledge base."""
    sample_docs_dir = Path(__file__).parents[3] / "sample_docs"
    count = 0
    if sample_docs_dir.exists():
        for doc_file in sample_docs_dir.glob("*.md"):
            title = doc_file.stem.replace("_", " ").title()
            await asyncio.to_thread(
                ingestion_pipeline.ingest_text,
                text=doc_file.read_text(encoding="utf-8", errors="ignore"),
                title=title,
                doc_format=DocumentFormat.MARKDOWN,
                source=str(doc_file.name),
                tenant_id=tenant_id,
            )
            count += 1
    retriever.update_chunks(vector_store.get_all_chunks(None))
    try:
        settings = request.app.state.settings
        disk_chunks = len(ingestion_pipeline.storage.load_all_chunks())
        qdrant_points = vector_store.count()
        request.app.state.index_consistency = check_consistency(settings, qdrant_points, disk_chunks)
        import services.rag_engine.routers.api as _api
        _api._index_consistency = request.app.state.index_consistency
    except Exception as error:  # noqa: BLE001
        logger.warning("Index consistency refresh failed: %s", error)
    return {"status": "seeded", "documents_seeded": count}


def _get_document_list_response(tenant_id: str) -> dict[str, Any]:
    """Builds the shared document catalog response dict."""
    docs = ingestion_pipeline.get_documents(tenant_id=tenant_id)
    total_chunks = sum(d.get("chunk_count", 0) for d in docs)
    total_entities = sum(d.get("entities_count", 0) for d in docs)
    return {
        "total_documents": len(docs),
        "total_chunks": total_chunks,
        "total_entities": total_entities,
        "documents": docs,
    }


@router.get("/v1/documents")
async def list_documents_endpoint(tenant_id: str = Depends(require_user)):
    """Lists all stored documents in the permanent knowledge base catalog."""
    return _get_document_list_response(tenant_id)


@router.get("/v1/documents/catalog")
async def catalog_alias_endpoint(tenant_id: str = Depends(require_user)):
    """Alias for document catalog - returns same as /v1/documents for UI compatibility.

    .. deprecated::
        Use :get:`/v1/documents` instead.
    """
    # Keep this static alias before the /{doc_id} routes below.
    response = _get_document_list_response(tenant_id)
    response["Deprecation"] = "true"
    response["Sunset"] = "2027-01-01"
    return response


@router.get("/v1/documents/{doc_id}/chunks")
async def get_document_chunks_endpoint(
    doc_id: str,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    tenant_id: str = Depends(require_user),
):
    """Returns a page of structural chunks for a document with headings and pages."""
    doc = await asyncio.to_thread(ingestion_pipeline.get_document, doc_id, tenant_id=tenant_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found in knowledge base.")
    chunks = doc.get("chunks", [])
    return {
        "document_id": doc_id,
        "title": doc.get("title", ""),
        "total_chunks": len(chunks),
        "limit": limit,
        "offset": offset,
        "chunks": chunks[offset : offset + limit],
    }


@router.get("/v1/documents/{doc_id}")
async def get_document_details_endpoint(doc_id: str, tenant_id: str = Depends(require_user)):
    """Retrieves full document metadata and its constituent chunks."""
    doc = await asyncio.to_thread(ingestion_pipeline.get_document, doc_id, tenant_id=tenant_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found in knowledge base.")
    return doc


@router.delete("/v1/documents/{doc_id}")
async def delete_document_endpoint(doc_id: str, request: Request, tenant_id: str = Depends(require_user)):
    """Deletes a document and evicts its chunks from vector, lexical, and graph stores."""
    doc = await asyncio.to_thread(ingestion_pipeline.get_document, doc_id, tenant_id=tenant_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found in knowledge base.")
    chunk_ids = [chunk["id"] for chunk in doc.get("chunks", [])]
    deleted = await asyncio.to_thread(ingestion_pipeline.delete_document, doc_id, tenant_id=tenant_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found in knowledge base.")
    retriever.remove_chunks(chunk_ids)
    try:
        settings = request.app.state.settings
        disk_chunks = len(ingestion_pipeline.storage.load_all_chunks())
        qdrant_points = vector_store.count()
        request.app.state.index_consistency = check_consistency(settings, qdrant_points, disk_chunks)
        import services.rag_engine.routers.api as _api
        _api._index_consistency = request.app.state.index_consistency
    except Exception as error:  # noqa: BLE001
        logger.warning("Index consistency refresh failed: %s", error)
    return {"status": "deleted", "document_id": doc_id, "message": "Document successfully deleted"}
