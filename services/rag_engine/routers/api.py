"""Meridian RAG Engine aggregation module (route handlers live in sub-routers).

This module owns application assembly: the aggregation ``router`` that mounts
every sub-router, the ``create_app`` factory with its lifespan, the shared
health/readiness helpers and error handlers, and the web-UI mount. The route
handlers themselves live in the sibling modules :mod:`ops`, :mod:`settings`,
:mod:`documents`, :mod:`query`, and :mod:`review`.

Shared runtime state and the dependency-injection seam live in
:mod:`services.rag_engine.routers._state`. Those names are deliberately
re-exported here (see the ``_state`` import below) so existing imports such as
``from services.rag_engine.app import vector_store`` keep working and the test
suite's ``monkeypatch.setattr(routers.api, ...)`` calls still land. The
sub-routers resolve service singletons through ``LiveRef``/``live`` so those
patches take effect at call time.
"""

import asyncio
import socket
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, cast

import httpx
from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from qdrant_client import QdrantClient

from packages.core.errors import IndexReadError, IndexWriteError, ProviderError
from packages.core.settings import get_settings as _core_get_settings
from packages.core.settings import validate_production as _validate_production
from services.gateway.auth import validate_auth_configuration
from services.gateway.client import LiteLLMClient
from services.gateway.guardrails.input_rails import InputGuardrails
from services.gateway.guardrails.output_rails import OutputGuardrails
from services.ingestion.embedder import FastEmbedEmbedder
from services.ingestion.graph_store import KnowledgeGraphStore
from services.ingestion.manifest import ConsistencyReport, check_consistency
from services.ingestion.pipeline import IngestionPipeline
from services.ingestion.vector_store import QdrantChunkStore
from services.rag_engine.agent.graph import build_rag_agent_graph
from services.rag_engine.deps import (
    get_services,
    require_admin,  # noqa: F401 - re-exported for test compatibility
)
from services.rag_engine.observability.langfuse_client import LangfuseTracer
from services.rag_engine.retrieval.hybrid import HybridRetriever
from services.rag_engine.retrieval.reranker import CrossEncoderReranker, LexicalReranker
from services.rag_engine.routers._state import (  # noqa: F401 - shared state re-exported for import/monkeypatch compatibility
    SECRET_SUFFIX,
    SETTINGS_FILE,
    ProviderURLNotAllowed,
    _active_services,
    _default_llm_settings,
    _default_runtime_settings,
    _default_service_cache,
    _default_services,
    _default_settings,
    _get_secrets_file,
    _get_settings_file,
    _index_gate,
    _is_masked,
    _load_persisted_settings,
    _merge_preserving_saved,
    _model_fetch_get,
    _resolve_active_llm_config_with_secrets,
    _runtime_llm_settings,
    _RuntimeSettings,
    _save_persisted_settings,
    _ServiceProxy,
    _settings,
    _settings_lock,
    _validate_model_fetch_url,
    agent_graph,
    bind_api_module,
    get_active_llm_config,
    graph_store,
    ingestion_pipeline,
    init_db,
    input_guardrails,
    llm_client,
    load_secrets,
    logger,
    masked_llm_view,
    output_guardrails,
    retriever,
    save_secrets,
    tracer,
    validate_provider_url,
    vector_store,
)
from services.rag_engine.routers.documents import (
    _get_document_list_response,  # noqa: F401 - re-exported for import compatibility
    catalog_alias_endpoint,  # noqa: F401 - re-exported for import compatibility
    clear_all_documents_endpoint,  # noqa: F401 - re-exported for import compatibility
    delete_document_endpoint,  # noqa: F401 - re-exported for import compatibility
    get_document_chunks_endpoint,  # noqa: F401 - re-exported for import compatibility
    get_document_details_endpoint,  # noqa: F401 - re-exported for import compatibility
    ingest_document_endpoint,  # noqa: F401 - re-exported for import compatibility
    list_documents_endpoint,  # noqa: F401 - re-exported for import compatibility
    seed_sample_documents_endpoint,  # noqa: F401 - re-exported for import compatibility
    upload_documents_endpoint,  # noqa: F401 - re-exported for test/import compatibility
)
from services.rag_engine.routers.documents import router as documents_router
from services.rag_engine.routers.ops import (
    get_index_status,  # noqa: F401 - re-exported for import compatibility
    get_metrics,  # noqa: F401 - re-exported for import compatibility
    health_check,  # noqa: F401 - re-exported for import compatibility
    health_live,  # noqa: F401 - re-exported for import compatibility
    health_ready,  # noqa: F401 - re-exported for import compatibility
    reindex_endpoint,  # noqa: F401 - re-exported for import compatibility
)
from services.rag_engine.routers.ops import router as ops_router
from services.rag_engine.routers.query import (
    GuardrailCheckRequest,  # noqa: F401 - re-exported for import compatibility
    RetrieveRequest,  # noqa: F401 - re-exported for import compatibility
    _FinalizedQueryResult,  # noqa: F401 - re-exported for import compatibility
    _finalize_query_result,  # noqa: F401 - re-exported for import compatibility
    _review_flags,  # noqa: F401 - re-exported for import compatibility
    _sse_event,  # noqa: F401 - re-exported for test/import compatibility
    _stream_query_response,  # noqa: F401 - re-exported for test/import compatibility
    check_guardrails_get,  # noqa: F401 - re-exported for import compatibility
    check_guardrails_post,  # noqa: F401 - re-exported for import compatibility
    query_endpoint,  # noqa: F401 - re-exported for import compatibility
    query_stream_endpoint,  # noqa: F401 - re-exported for import compatibility
    retrieve_endpoint,  # noqa: F401 - re-exported for import compatibility
)
from services.rag_engine.routers.query import router as query_router
from services.rag_engine.routers.review import router as review_router
from services.rag_engine.routers.settings import (
    TestAndFetchModelsRequest,  # noqa: F401 - re-exported for test/import compatibility
    get_llm_settings,  # noqa: F401 - re-exported for import compatibility
    get_providers_status,  # noqa: F401 - re-exported for import compatibility
    test_and_fetch_models,  # noqa: F401 - re-exported for test/import compatibility
    test_llm_connection,  # noqa: F401 - re-exported for import compatibility
    update_llm_settings,  # noqa: F401 - re-exported for import compatibility
)
from services.rag_engine.routers.settings import router as settings_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize the semantic model once before serving or loading persisted chunks."""
    settings = app.state.settings or _core_get_settings()
    app.state.settings = settings
    validate_auth_configuration()
    _validate_production(settings)
    if ingestion_pipeline.embedder is None:
        embedder = await asyncio.to_thread(
            FastEmbedEmbedder,
            settings.embedding_model,
            cache_path=settings.fastembed_cache_path,
            expected_dim=settings.qdrant_vector_dim,
        )
        ingestion_pipeline.embedder = embedder
    retriever.embedder = ingestion_pipeline.embedder
    retriever.reranker = None
    if settings.reranker == "lexical":
        retriever.reranker = LexicalReranker()
    elif settings.reranker == "cross_encoder":
        retriever.reranker = await asyncio.to_thread(
            CrossEncoderReranker, settings.reranker_model, settings.fastembed_cache_path
        )
    await asyncio.to_thread(vector_store.ensure_collection)
    docs_loaded = await asyncio.to_thread(ingestion_pipeline.load_persisted_knowledge_base)
    logger.info("Hydrated %d documents from dedicated storage.", docs_loaded)
    retriever.update_chunks(vector_store.get_all_chunks(None))
    global _index_consistency, _service_status
    disk_chunks = await asyncio.to_thread(lambda: len(ingestion_pipeline.storage.load_all_chunks()))
    qdrant_points = await asyncio.to_thread(vector_store.count)
    _index_consistency = await asyncio.to_thread(
        check_consistency, settings, qdrant_points, disk_chunks
    )
    app.state.index_consistency = _index_consistency
    app.state.service_status = await asyncio.to_thread(_check_docker_services, settings)
    _service_status = app.state.service_status
    if _index_consistency.ok:
        logger.info("Index consistent: %d chunks across disk and Qdrant.", disk_chunks)
    else:
        logger.error("Index inconsistent; queries are refused until reindex: %s", _index_consistency.reasons)
    try:
        await init_db()
    except Exception as e:  # noqa: BLE001 - preserve existing database startup behavior
        logger.warning("Database initialization warning: %s", e)
    yield


router = APIRouter(dependencies=[Depends(get_services)])
router.include_router(review_router)
router.include_router(ops_router)
router.include_router(settings_router)
router.include_router(documents_router)
router.include_router(query_router)


async def handle_index_error(request: Request, error: IndexWriteError | IndexReadError) -> JSONResponse:
    code = 'index_write_error' if isinstance(error, IndexWriteError) else 'index_read_error'
    return JSONResponse(status_code=503, content={'error': {'code': code, 'message': str(error)}})


async def handle_provider_error(request: Request, error: ProviderError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status,
        content={"error": {
            "code": "provider_error",
            "message": error.message,
            "provider_message": error.provider_message,
        }},
    )


async def limit_model_fetch_json_body(request: Request, call_next):
    if request.url.path == "/v1/settings/llm/test-and-fetch-models" and request.method == "POST":
        body = await request.body()
        if len(body) > 1024 * 1024:
            return JSONResponse(status_code=413, content={"detail": "Request body too large."})
    return await call_next(request)




# Startup consistency verdict; None until the lifespan has run.
_index_consistency: ConsistencyReport | None = None

# Service readiness tracking
_service_status: dict[str, Any] = {
    "qdrant": {"status": "unknown", "endpoint": "", "reachable": False},
    "neo4j": {"status": "unknown", "endpoint": "", "reachable": False},
    "litellm": {"status": "unknown", "endpoint": "", "reachable": False},
}


def _probe_http(url: str, timeout: float = 2.0) -> bool:
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url)
            return resp.status_code < 500
    except Exception:  # noqa: BLE001 - any probe failure means unreachable
        return False


def _probe_tcp(host: str, port: int, timeout: float = 2.0) -> bool:
    """Probe a TCP port (used for Bolt/Neo4j and other non-HTTP services)."""
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except (OSError, ValueError):
        return False


def _check_docker_services(settings=None) -> dict[str, Any]:
    if settings is None:
        settings = _core_get_settings()

    qdrant_host = getattr(settings, "qdrant_host", "localhost") if settings else "localhost"
    qdrant_port = getattr(settings, "qdrant_port", 6333) if settings else 6333
    qdrant_url = f"http://{qdrant_host}:{qdrant_port}/collections" if settings else "http://localhost:6333/collections"

    from urllib.parse import urlparse

    neo4j_uri = getattr(settings, "neo4j_uri", "bolt://localhost:7687") if settings else "bolt://localhost:7687"
    try:
        parsed = urlparse(str(neo4j_uri))
        neo4j_host = parsed.hostname or "localhost"
        neo4j_port = parsed.port or 7687
    except Exception:  # noqa: BLE001 - fall back to defaults on malformed URI
        neo4j_host, neo4j_port = "localhost", 7687
    neo4j_http_url = f"http://{neo4j_host}:7474"
    neo4j_endpoint = f"bolt://{neo4j_host}:{neo4j_port}"

    litellm_url = f"{getattr(settings, 'litellm_base_url', 'http://localhost:4000').rstrip('/')}/health" if settings else "http://localhost:4000/health"

    qdrant_ok = _probe_http(qdrant_url)
    neo4j_ok = _probe_http(neo4j_http_url) or _probe_tcp(neo4j_host, neo4j_port)
    litellm_ok = _probe_http(litellm_url) or _probe_http(f"{litellm_url}/readiness")

    statuses: dict[str, Any] = {
        "qdrant": {"status": "reachable" if qdrant_ok else "degraded", "endpoint": qdrant_url, "reachable": qdrant_ok},
        "neo4j": {"status": "reachable" if neo4j_ok else "degraded", "endpoint": neo4j_endpoint, "reachable": neo4j_ok},
        "litellm": {"status": "reachable" if litellm_ok else "degraded", "endpoint": litellm_url, "reachable": litellm_ok},
    }
    return statuses


def _log_service_banner(statuses: dict[str, Any]) -> None:
    lines = ["", "=" * 62, " Meridian Service Readiness Check", "=" * 62]
    for name, info in statuses.items():
        icon = "✓" if info["reachable"] else "✗"
        state = "REACHABLE" if info["reachable"] else "DEGRADED"
        lines.append(f"  {icon} {name:10s} [{state:30s}] {info['endpoint']}")
    if all(v["reachable"] for v in statuses.values()):
        lines.append("  All Docker services reachable - production mode")
    else:
        lines.append("  Some services degraded - in-memory fallback active (graceful)")
    lines.append("=" * 62)
    logger.info("\n".join(lines))


def create_app(settings=None, overrides=None) -> FastAPI:
    """Create a FastAPI app with per-instance services initialized at startup."""
    service_overrides = dict(overrides or {})

    @asynccontextmanager
    async def app_lifespan(application: FastAPI):
        runtime_settings = application.state.settings or _core_get_settings()
        application.state.settings = runtime_settings
        if getattr(application.state, "use_legacy_services", False):
            runtime_settings = _settings._target()
            application.state.settings = runtime_settings
            services = _default_services()
            services["runtime_llm_settings"] = _runtime_llm_settings._target()
        else:
            required_services = {
            "vector_store", "graph_store", "ingestion_pipeline", "tracer", "retriever",
            "llm_client", "input_guardrails", "output_guardrails", "agent_graph",
        }
            if required_services.issubset(service_overrides):
                services = dict(service_overrides)
            else:
                services = _build_services(runtime_settings)
                services.update(service_overrides)
            services["runtime_llm_settings"] = service_overrides.get(
                "runtime_llm_settings", _load_persisted_settings()
            )
        for name, service in services.items():
            setattr(application.state, name, service)
        token = _active_services.set({**services, "settings": runtime_settings})
        try:
            await _startup(application, runtime_settings)
            yield
        finally:
            try:
                llm = getattr(application.state, "llm_client", None)
                closer = getattr(llm, "close", None)
                if callable(closer):
                    await closer()
            except Exception:  # noqa: BLE001
                logger.debug("LLM client close failed", exc_info=True)
            _active_services.reset(token)

    application = FastAPI(
        title="Meridian LLMOps RAG Engine",
        version="0.1.0",
        description="Production-grade Self-Healing Agentic RAG Platform with Guardrails and Tracing",
        lifespan=app_lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    @application.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        response.headers.setdefault("Content-Security-Policy", "default-src 'self'")
        return response

    application.include_router(router)
    application.add_exception_handler(IndexWriteError, cast(Any, handle_index_error))
    application.add_exception_handler(IndexReadError, cast(Any, handle_index_error))
    application.add_exception_handler(ProviderError, cast(Any, handle_provider_error))
    application.middleware("http")(bind_app_services)
    application.middleware("http")(limit_model_fetch_json_body)
    application.state.settings = settings
    application.state.service_overrides = service_overrides
    application.state.service_status = {
        name: dict(status) for name, status in _service_status.items()
    }
    return application


async def bind_app_services(request: Request, call_next):
    services = getattr(request.app.state, "service_overrides", {})
    if getattr(request.app.state, "vector_store", None) is not None:
        services = {name: getattr(request.app.state, name) for name in (
            "vector_store", "graph_store", "ingestion_pipeline", "tracer", "retriever",
            "llm_client", "input_guardrails", "output_guardrails", "agent_graph",
        )}
        services["settings"] = (
            _core_get_settings()
            if getattr(request.app.state, "use_legacy_services", False)
            else request.app.state.settings
        )
        services["runtime_llm_settings"] = request.app.state.runtime_llm_settings
    token = _active_services.set(services or None)
    try:
        return await call_next(request)
    finally:
        _active_services.reset(token)


def _build_services(settings) -> dict[str, Any]:
    client = (QdrantClient(':memory:') if settings.qdrant_local_path == ':memory:' else QdrantClient(path=settings.qdrant_local_path)) if settings.vector_backend == 'qdrant_local' else QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port, timeout=5)
    vector = QdrantChunkStore(client, settings.qdrant_collection, settings.qdrant_vector_dim)
    graph = KnowledgeGraphStore(in_memory=not settings.graph_enabled)
    pipeline = IngestionPipeline(vector_store=vector, graph_store=graph, max_upload_bytes=settings.max_upload_mb * 1024 * 1024)
    trace = LangfuseTracer()
    retrieval = HybridRetriever(embedder=None, vector_store=vector, tracer=trace)
    llm = LiteLLMClient(allow_private_provider_urls=settings.allow_private_provider_urls)
    return {
        "vector_store": vector,
        "graph_store": graph,
        "ingestion_pipeline": pipeline,
        "tracer": trace,
        "retriever": retrieval,
        "llm_client": llm,
        "input_guardrails": InputGuardrails(),
        "output_guardrails": OutputGuardrails(),
        "agent_graph": build_rag_agent_graph(
            retriever=retrieval,
            graph_store=graph,
            llm_client=llm,
            llm_config_getter=_resolve_active_llm_config_with_secrets,
            min_dense_score=settings.min_dense_score,
            graph_enabled=settings.graph_enabled,
            graph_context_enabled=settings.graph_context_enabled,
            debug_log_prompts=settings.debug_log_prompts,
            verify_mode=settings.verify_mode,
            tracer=trace,
        ),
    }


async def _startup(application: FastAPI, settings) -> None:
    """Initialize runtime resources for the app instance."""
    validate_auth_configuration()
    _validate_production(settings)
    embedder = application.state.ingestion_pipeline.embedder
    if embedder is None:
        embedder = await asyncio.to_thread(
            FastEmbedEmbedder,
            settings.embedding_model,
            cache_path=settings.fastembed_cache_path,
            expected_dim=settings.qdrant_vector_dim,
        )
        application.state.ingestion_pipeline.embedder = embedder
    application.state.retriever.embedder = embedder
    if settings.reranker == "lexical":
        application.state.retriever.reranker = LexicalReranker()
    elif settings.reranker == "cross_encoder":
        application.state.retriever.reranker = await asyncio.to_thread(
            CrossEncoderReranker, settings.reranker_model, settings.fastembed_cache_path
        )
    await asyncio.to_thread(application.state.vector_store.ensure_collection)
    await asyncio.to_thread(application.state.ingestion_pipeline.load_persisted_knowledge_base)
    application.state.retriever.update_chunks(application.state.vector_store.get_all_chunks(None))
    disk_chunks = await asyncio.to_thread(lambda: len(application.state.ingestion_pipeline.storage.load_all_chunks()))
    qdrant_points = await asyncio.to_thread(application.state.vector_store.count)
    service_overrides = application.state.service_overrides
    if "index_consistency" not in service_overrides:
        application.state.index_consistency = await asyncio.to_thread(
            check_consistency, settings, qdrant_points, disk_chunks
        )
    if "service_status" not in service_overrides:
        application.state.service_status = await asyncio.to_thread(_check_docker_services, settings)
    if getattr(application.state, "use_legacy_services", False):
        global _index_consistency, _service_status
        _index_consistency = application.state.index_consistency
        _service_status = application.state.service_status
    _log_service_banner(application.state.service_status)
    try:
        await init_db()
    except Exception as error:  # noqa: BLE001 - keep the existing degraded DB startup behavior
        logger.warning("Database initialization warning: %s", error)
    mount_web(application)


# Mount Web UI frontend if built
web_dist = Path(__file__).parents[2] / "web" / "dist"
def mount_web(app: FastAPI) -> None:
    if web_dist.exists():
        app.mount("/", StaticFiles(directory=str(web_dist), html=True), name="web")


app = create_app()
app.state.use_legacy_services = True
bind_api_module(sys.modules[__name__])
