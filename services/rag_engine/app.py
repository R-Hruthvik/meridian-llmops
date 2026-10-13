"""Unified Meridian RAG Engine & LLMOps FastAPI Application."""

import asyncio
import ipaddress
import json
import logging
import os
import socket
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import urlsplit

import httpcore
import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from qdrant_client import QdrantClient

from packages.core.db import AsyncSessionLocal, init_db
from packages.core.errors import IndexReadError, IndexWriteError, IngestionError, ProviderError
from packages.core.models import (
    DocumentFormat,
    GuardrailResult,
    IndexStatusResponse,
    IngestDocumentRequest,
    QueryRequest,
    QueryResponse,
    SearchResult,
    ServingProvenance,
    UpdateLLMSettingsRequest,
    VerificationSummary,
)
from packages.core.secrets_store import SECRET_SUFFIX, load_secrets, save_secrets
from packages.core.settings import get_settings as _core_get_settings
from packages.core.settings import validate_production as _validate_production
from services.gateway.auth import validate_auth_configuration
from services.gateway.client import LiteLLMClient
from services.gateway.guardrails.input_rails import InputGuardrails
from services.gateway.guardrails.output_rails import OutputGuardrails
from services.ingestion import storage as ingestion_storage
from services.ingestion.embedder import FastEmbedEmbedder
from services.ingestion.graph_store import KnowledgeGraphStore
from services.ingestion.manifest import ConsistencyReport, check_consistency
from services.ingestion.pipeline import IngestionPipeline
from services.ingestion.vector_store import QdrantChunkStore
from services.rag_engine.agent.graph import build_rag_agent_graph
from services.rag_engine.deps import require_admin, require_user
from services.rag_engine.index_inspector import build_index_status
from services.rag_engine.observability.langfuse_client import LangfuseTracer
from services.rag_engine.retrieval.hybrid import HybridRetriever
from services.rag_engine.retrieval.reranker import CrossEncoderReranker, LexicalReranker
from services.rag_engine.routers.review import router as review_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize the semantic model once before serving or loading persisted chunks."""
    settings = _core_get_settings()
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
    global _index_consistency
    disk_chunks = await asyncio.to_thread(lambda: len(ingestion_pipeline.storage.load_all_chunks()))
    qdrant_points = await asyncio.to_thread(vector_store.count)
    _index_consistency = await asyncio.to_thread(
        check_consistency, settings, qdrant_points, disk_chunks
    )
    if _index_consistency.ok:
        logger.info("Index consistent: %d chunks across disk and Qdrant.", disk_chunks)
    else:
        logger.error("Index inconsistent; queries are refused until reindex: %s", _index_consistency.reasons)
    try:
        await init_db()
    except Exception as e:  # noqa: BLE001 - preserve existing database startup behavior
        logger.warning("Database initialization warning: %s", e)
    yield


app = FastAPI(
    title="Meridian LLMOps RAG Engine",
    version="0.1.0",
    description="Production-grade Self-Healing Agentic RAG Platform with Guardrails and Tracing",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.include_router(review_router)


@app.exception_handler(IndexWriteError)
@app.exception_handler(IndexReadError)
async def handle_index_error(request: Request, error: IndexWriteError | IndexReadError) -> JSONResponse:
    code = 'index_write_error' if isinstance(error, IndexWriteError) else 'index_read_error'
    return JSONResponse(status_code=503, content={'error': {'code': code, 'message': str(error)}})


@app.exception_handler(ProviderError)
async def handle_provider_error(request: Request, error: ProviderError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status,
        content={"error": {
            "code": "provider_error",
            "message": error.message,
            "provider_message": error.provider_message,
        }},
    )


@app.middleware("http")
async def limit_model_fetch_json_body(request: Request, call_next):
    if request.url.path == "/v1/settings/llm/test-and-fetch-models" and request.method == "POST":
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > 1024 * 1024:
                return JSONResponse(status_code=413, content={"detail": "Request body too large."})
            body.extend(chunk)

        payload = bytes(body)

        async def receive():
            return {"type": "http.request", "body": payload, "more_body": False}

        request = Request(request.scope, receive)
    return await call_next(request)


# Qdrant uses an explicit backend; service failures never switch backends.
_settings = _core_get_settings()
_qdrant_client = ((QdrantClient(':memory:') if _settings.qdrant_local_path == ':memory:'
                   else QdrantClient(path=_settings.qdrant_local_path))
                  if _settings.vector_backend == 'qdrant_local'
                  else QdrantClient(host=_settings.qdrant_host, port=_settings.qdrant_port, timeout=5))
vector_store = QdrantChunkStore(_qdrant_client, _settings.qdrant_collection, _settings.qdrant_vector_dim)
graph_store = KnowledgeGraphStore(in_memory=not _settings.graph_enabled)
ingestion_pipeline = IngestionPipeline(
    vector_store=vector_store,
    graph_store=graph_store,
    max_upload_bytes=_settings.max_upload_mb * 1024 * 1024,
)
tracer = LangfuseTracer()
retriever = HybridRetriever(embedder=None, vector_store=vector_store, tracer=tracer)
input_guardrails = InputGuardrails()
output_guardrails = OutputGuardrails()
llm_client = LiteLLMClient()

logger = logging.getLogger("meridian.rag_engine")

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


def _check_docker_services() -> dict[str, Any]:
    from packages.core.config import get_settings as _get_settings

    try:
        settings = _get_settings()
    except Exception:  # noqa: BLE001 - degraded banner is better than a boot crash
        settings = None  # type: ignore[assignment]

    qdrant_url = f"http://{getattr(settings, 'qdrant_host', 'localhost')}:{getattr(settings, 'qdrant_port', 6333)}/collections" if settings else "http://localhost:6333/collections"
    neo4j_url = "http://localhost:7474"
    litellm_url = f"{getattr(settings, 'litellm_base_url', 'http://localhost:4000').rstrip('/')}/health" if settings else "http://localhost:4000/health"

    qdrant_ok = _probe_http(qdrant_url)
    neo4j_ok = _probe_http(neo4j_url)
    litellm_ok = _probe_http(litellm_url) or _probe_http(f"{litellm_url}/readiness")

    statuses: dict[str, Any] = {
        "qdrant": {"status": "reachable" if qdrant_ok else "degraded", "endpoint": qdrant_url, "reachable": qdrant_ok},
        "neo4j": {"status": "reachable" if neo4j_ok else "degraded", "endpoint": neo4j_url, "reachable": neo4j_ok},
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


# Persistent runtime LLM settings
def _get_settings_file() -> Path:
    if os.environ.get("APP_ENV") == "testing":
        return Path("/tmp/meridian_test_settings.json")
    return Path(__file__).parents[2] / ".meridian_settings.json"


SETTINGS_FILE = _get_settings_file()


def _get_secrets_file() -> Path:
    return ingestion_storage.get_default_storage_root() / "secrets.json"

_default_llm_settings: dict[str, Any] = {
    "active_provider": "openai",
    "openai_api_key": "",
    "openai_org_id": "",
    "openai_proj_id": "",
    "anthropic_api_key": "",
    "groq_api_key": "",
    "openrouter_api_key": "",
    "deepseek_api_key": "",
    "custom_api_key": "",
    "openai_base_url": "",
    "anthropic_base_url": "",
    "groq_base_url": "",
    "openrouter_base_url": "",
    "deepseek_base_url": "",
    "ollama_base_url": "",
    "custom_base_url": "",
    "default_model": "gpt-4o-mini",
    "litellm_base_url": "http://localhost:4000",
    "provider_models": {
        "openai": "gpt-4o-mini",
        "anthropic": "claude-3-5-sonnet-20241022",
        "groq": "llama-3.3-70b-versatile",
        "openrouter": "meta-llama/llama-3.3-70b-instruct",
        "deepseek": "deepseek-chat",
        "ollama": "llama3",
        "custom": "llama-3.3-70b-versatile",
    },
}

def _load_persisted_settings() -> dict[str, Any]:
    settings = dict(_default_llm_settings)
    settings_file = _get_settings_file()
    saved: dict[str, Any] = {}
    if settings_file.exists():
        try:
            with open(settings_file, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    saved = loaded
        except (OSError, ValueError, TypeError):
            logger.warning("Could not load settings file.")
    legacy_secrets = {k: v for k, v in saved.items() if k.endswith(SECRET_SUFFIX)}
    settings.update({k: v for k, v in saved.items() if not k.endswith(SECRET_SUFFIX)})
    secrets_file = _get_secrets_file()
    secrets = load_secrets(secrets_file)
    if legacy_secrets:
        secrets = _merge_preserving_saved(legacy_secrets, secrets)
        save_secrets(secrets_file, secrets)
        try:
            preferences = {k: v for k, v in settings.items() if not k.endswith(SECRET_SUFFIX)}
            settings_file.write_text(json.dumps(preferences, indent=2), encoding="utf-8")
            os.chmod(settings_file, 0o600)
        except OSError:
            logger.warning("Could not remove migrated secrets from settings file.")
    settings.update(secrets)
    return settings

def _is_masked(value: str) -> bool:
    return "..." in value or value == "***"


def _merge_preserving_saved(base: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    """Non-destructive merge: incoming masked or blank strings never clobber saved values."""
    merged = dict(base)
    for k, v in incoming.items():
        if isinstance(v, str):
            if _is_masked(v):
                continue
            if v == "" and merged.get(k):
                # Never wipe a saved value with a blank submission
                continue
        merged[k] = v
    return merged


def _validate_model_fetch_url(provider: str, url: str) -> tuple[str, str, int, tuple[str, ...]]:
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError
        if (
            parsed.username is not None
            or parsed.password is not None
            or "?" in url
            or "#" in url
        ):
            raise ValueError
        hostname = parsed.hostname.encode("idna").decode("ascii").lower()
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        addresses = {
            ipaddress.ip_address(str(info[4][0]).split("%", 1)[0])
            for info in socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
        }
        if not addresses:
            raise ValueError
        if provider in {"ollama", "custom", "openai_compatible"}:
            if hostname not in {"localhost", "127.0.0.1", "::1"}:
                raise ValueError
            if not all(address.is_loopback for address in addresses):
                raise ValueError
        elif not all(
            address.is_global
            and not (address.is_private or address.is_loopback or address.is_link_local
                     or address.is_unspecified or address.is_multicast or address.is_reserved)
            for address in addresses
        ):
            raise ValueError
    except (OSError, ValueError, IndexError):
        raise ValueError("Provider URL is not allowed.") from None
    return url, hostname, port, tuple(sorted(str(address) for address in addresses))


class _PinnedAddressBackend:
    """Connects only to the validated IPs while HTTPCore keeps the URL hostname for TLS."""

    def __init__(self, network_backend: Any):
        self._network_backend = network_backend
        self._addresses: dict[tuple[str, int], tuple[str, ...]] = {}

    def pin(self, host: str, port: int, addresses: tuple[str, ...]) -> None:
        self._addresses[(host.lower(), port)] = addresses

    async def connect_tcp(self, host: str, port: int, **kwargs: Any) -> Any:
        addresses = self._addresses.get((host.lower(), port), ())
        if not addresses:
            raise OSError("No validated provider address is available.")
        last_error: Exception | None = None
        for address in addresses:
            try:
                return await self._network_backend.connect_tcp(address, port, **kwargs)
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as error:
                last_error = error
        if last_error:
            raise last_error
        raise OSError("No validated provider address is available.")

    async def connect_unix_socket(self, path: str, **kwargs: Any) -> Any:
        return await self._network_backend.connect_unix_socket(path, **kwargs)

    async def sleep(self, seconds: float) -> None:
        await self._network_backend.sleep(seconds)


class _PinnedAsyncHTTPTransport(httpx.AsyncHTTPTransport):
    def __init__(self):
        super().__init__(trust_env=False)
        self.address_backend = _PinnedAddressBackend(self._pool._network_backend)
        self._pool._network_backend = self.address_backend


async def _model_fetch_get(
    client: httpx.AsyncClient,
    transport: _PinnedAsyncHTTPTransport,
    provider: str,
    url: str,
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    safe_url, host, port, addresses = _validate_model_fetch_url(provider, url)
    transport.address_backend.pin(host, port, addresses)
    async with client.stream("GET", safe_url, headers=headers) as response:
        body = bytearray()
        async for chunk in response.aiter_bytes():
            if len(body) + len(chunk) > 1024 * 1024:
                raise ValueError("Provider response exceeds 1 MiB limit.")
            body.extend(chunk)
        return httpx.Response(
            status_code=response.status_code,
            headers=response.headers,
            content=bytes(body),
            request=httpx.Request("GET", safe_url),
        )


def masked_llm_view(d: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in d.items():
        if k.endswith(SECRET_SUFFIX):
            if not v:
                out[k] = {"configured": False}
            elif isinstance(v, str) and len(v) > 4:
                out[k] = {"configured": True, "hint": v[-4:]}
            else:
                out[k] = {"configured": True, "hint": "****"}
        else:
            out[k] = v
    return out


def _save_persisted_settings(settings: dict[str, Any]) -> None:
    settings_file = _get_settings_file()
    existing: dict[str, Any] = {}
    if settings_file.exists():
        try:
            with open(settings_file, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except (OSError, ValueError, TypeError):
            existing = {}
    if not isinstance(existing, dict):
        existing = {}
    secrets_file = _get_secrets_file()
    secrets = load_secrets(secrets_file)
    legacy_secrets = {k: v for k, v in existing.items() if k.endswith(SECRET_SUFFIX)}
    secrets = _merge_preserving_saved(legacy_secrets, secrets)
    incoming_secrets = {k: v for k, v in settings.items() if k.endswith(SECRET_SUFFIX)}
    secrets = _merge_preserving_saved(secrets, incoming_secrets)
    merged = _merge_preserving_saved(
        {k: v for k, v in existing.items() if not k.endswith(SECRET_SUFFIX)},
        {k: v for k, v in settings.items() if not k.endswith(SECRET_SUFFIX)},
    )
    try:
        if secrets:
            save_secrets(secrets_file, secrets)
        with open(settings_file, "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=2)
        os.chmod(settings_file, 0o600)
    except (OSError, ValueError, TypeError):
        logger.warning("Could not save settings.")

_runtime_llm_settings: dict[str, Any] = _load_persisted_settings()

# Session-only cache for tested API keys (not persisted to disk)
_tested_api_keys: dict[str, str] = {}

_settings_lock = asyncio.Lock()


def _resolve_active_llm_config_with_secrets() -> dict[str, Any]:
    """Resolves active provider credentials, endpoints, and exact model dynamically.

    Internal only: returns secrets (``api_key``) for the LLM data plane
    (agent graph, connectivity test). Never expose via API responses.
    """
    settings = dict(_runtime_llm_settings)
    env_settings = _core_get_settings()
    generic = {
        "provider": env_settings.provider,
        "api_key": env_settings.api_key,
        "base_url": env_settings.base_url,
        "model": env_settings.model,
    }
    generic_active = any(isinstance(v, str) and v.strip() for k, v in generic.items() if k != "provider")
    provider = (generic["provider"] or ("custom" if generic_active else settings.get("active_provider", "openai"))).lower()
    if generic_active:
        defaults = {
            "openai": ("https://api.openai.com/v1", "gpt-4o-mini"),
            "anthropic": ("https://api.anthropic.com", "claude-3-5-sonnet-20241022"),
            "openrouter": ("https://openrouter.ai/api/v1", "meta-llama/llama-3.3-70b-instruct"),
            "deepseek": ("https://api.deepseek.com/v1", "deepseek-chat"),
            "groq": ("https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"),
            "ollama": ("http://localhost:11434/v1", "llama3:latest"),
            "custom": ("", ""),
        }
        default_url, default_model = defaults.get(provider, ("", ""))
        return {
            "provider": provider,
            "model": generic["model"] or default_model,
            "api_key": generic["api_key"] or None,
            "base_url": generic["base_url"] or default_url,
        }
    provider_models = settings.get("provider_models", {})
    configured_model = settings.get("default_model")
    from services.gateway.providers import PROVIDERS

    if provider == "openai_compatible":
        provider = "custom"
    if provider not in PROVIDERS:
        return {"provider": provider, "model": configured_model or "", "api_key": None, "base_url": ""}
    default_models = {"openai": "gpt-4o-mini", "anthropic": "claude-3-5-sonnet-20241022", "openrouter": "meta-llama/llama-3.3-70b-instruct", "deepseek": "deepseek-chat", "groq": "llama-3.3-70b-versatile", "ollama": "llama3:latest", "custom": ""}
    model = configured_model or provider_models.get(provider) or default_models[provider]
    api_key = _core_get_settings().__getattribute__(f"{provider}_api_key") or settings.get(f"{provider}_api_key")
    api_key = api_key or _tested_api_keys.get(provider)
    base_url = _core_get_settings().__getattribute__(f"{provider}_base_url") or settings.get(f"{provider}_base_url") or PROVIDERS[provider]["base_url_default"]
    if provider == "custom":
        base_url = _core_get_settings().custom_base_url or settings.get("custom_base_url") or base_url

    return {
        "provider": provider,
        "model": model,
        "api_key": api_key,
        "base_url": base_url,
    }


def get_active_llm_config() -> dict[str, str]:
    """Thin no-secrets reader over the single settings owner."""
    from packages.core.settings import get_settings

    s = get_settings()
    return {"provider": "openai", "model": s.default_llm_model, "base_url": s.litellm_base_url}


# Check Docker-backed services readiness (non-blocking, graceful fallback)
try:
    _service_status = _check_docker_services()
    _log_service_banner(_service_status)
except Exception as e:  # noqa: BLE001
    logger.warning("Service readiness check failed: %s", e)

agent_graph = build_rag_agent_graph(
    retriever=retriever,
    graph_store=graph_store,
    llm_client=llm_client,
    llm_config_getter=_resolve_active_llm_config_with_secrets,
    min_dense_score=_settings.min_dense_score,
    graph_enabled=_settings.graph_enabled,
    debug_log_prompts=_settings.debug_log_prompts,
    verify_mode=_settings.verify_mode,
    tracer=tracer,
)


class GuardrailCheckRequest(BaseModel):
    text: str = Field(..., min_length=1)


@app.get("/v1/guardrails/check", response_model=GuardrailResult, deprecated=True)
async def check_guardrails_get(
    text: str,
    tenant_id: str = Depends(require_user),
):
    """Legacy query-string form; use POST to keep submitted text out of URLs.

    Served here too because the browser reaches the rag engine directly.
    """
    return input_guardrails.evaluate(text)


@app.post("/v1/guardrails/check", response_model=GuardrailResult)
async def check_guardrails_post(
    payload: GuardrailCheckRequest,
    tenant_id: str = Depends(require_user),
):
    """Evaluate text against the shared input guardrails."""
    return input_guardrails.evaluate(payload.text)


class RetrieveRequest(BaseModel):
    """Retrieval-only payload: no LLM call, just ranked chunks."""

    query: str = Field(..., min_length=1, description="Search query")
    top_k: int = Field(5, ge=1, le=20, description="Number of chunks to return")
    debug: bool = Field(False, description="Include per-stage score detail")


@app.post("/v1/retrieve")
async def retrieve_endpoint(
    payload: RetrieveRequest,
    tenant_id: str = Depends(require_user),
):
    """Runs hybrid retrieval only (dense + BM25 + RRF) and returns ranked chunks.

    The primary debugging tool: inspect which chunks would reach the LLM,
    with per-stage scores and stage timings, before involving generation.
    """
    blocked = _index_gate()
    if blocked is not None:
        return blocked
    result = retriever.retrieve(payload.query, top_k=payload.top_k, tenant_id=tenant_id, debug=payload.debug)
    return {
        "query": result.query,
        "top_k": result.top_k,
        "chunks": [ranked.to_dict() for ranked in result.chunks],
        "timings_ms": result.timings_ms,
    }


def _index_gate() -> JSONResponse | None:
    """Refuse query/retrieve while the index cannot be trusted (no silent fallback)."""
    report = _index_consistency
    if report is not None and not report.ok:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "error": {
                    "code": "index_inconsistent",
                    "message": "The vector index is inconsistent with disk records; run scripts/reindex.py",
                    "reasons": report.reasons,
                }
            },
        )
    return None


@app.get("/health/live")
async def health_live():
    """Process liveness: the app is up and serving."""
    return {"alive": True}


@app.get("/health/ready")
async def health_ready():
    """Return only the serving-readiness bit needed by external probes."""
    qdrant_health = vector_store.health()
    index_ok = _index_consistency.ok if _index_consistency is not None else False
    embedder = ingestion_pipeline.embedder
    ready = qdrant_health["status"] == "ready" and index_ok and embedder is not None
    return {"ready": ready}


@app.post("/v1/documents")
async def upload_documents_endpoint(
    files: Annotated[list[UploadFile], File()],
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
            result = ingestion_pipeline.ingest_file(filename, bytes(data), tenant_id=tenant_id)
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
    return {"results": results}


@app.get("/health")
async def health_check(tenant_id: str = Depends(require_user)):
    return {
        "status": "healthy",
        "service": "meridian-rag-engine",
        # Live count, same source as /v1/documents - a boot-time snapshot went stale on ingest.
        "storage_documents": len(ingestion_pipeline.get_documents(tenant_id=tenant_id)),
        "vector_chunks": vector_store.count(tenant_id=tenant_id),
        "services": _service_status,
    }


@app.post("/v1/ingest")
async def ingest_document_endpoint(
    payload: IngestDocumentRequest,
    tenant_id: str = Depends(require_user),
):
    """Ingests text into dedicated disk storage, the Qdrant vector store, and the graph."""
    try:
        result = ingestion_pipeline.ingest_text(
            text=payload.text,
            title=payload.title or "Uploaded Document",
            source=payload.source or "manual",
            doc_format=DocumentFormat(payload.format) if payload.format else DocumentFormat.MARKDOWN,
            tenant_id=tenant_id,
        )
    except IngestionError as error:
        cause = error.__cause__
        if isinstance(cause, (IndexWriteError, IndexReadError)):
            # A typed index failure must reach the caller with its own code.
            raise cause from None
        raise HTTPException(status_code=400, detail=str(error)) from error
    retriever.update_chunks(vector_store.get_all_chunks(None))
    return {
        **result.to_dict(),
        "title": payload.title or "Uploaded Document",
        "chunks_indexed": result.chunks,
    }


@app.post("/v1/query", response_model=QueryResponse)
async def query_endpoint(
    req: QueryRequest,
    tenant_id: str = Depends(require_user),
):
    """Executes the self-healing Agentic RAG pipeline with guardrails and tracing."""
    blocked = _index_gate()
    if blocked is not None:
        return blocked
    start_time = time.perf_counter()
    request_id = str(uuid.uuid4())
    trace_ctx = tracer.trace(name="rag-query-pipeline", tenant_id=tenant_id, query=req.query)
    client_guardrails_enabled = not (
        req.enforce_guardrails is False and _settings.allow_client_disable_guardrails
    )
    input_guardrails_enabled = _settings.enable_input_guardrails and client_guardrails_enabled
    output_guardrails_enabled = _settings.enable_output_guardrails and client_guardrails_enabled

    with trace_ctx as trace:
        # 1. Input Guardrails
        if input_guardrails_enabled:
            with trace.span("input-guardrails") as span:
                guard_result = input_guardrails.evaluate(req.query)
                span.set_attribute("allowed", guard_result.allowed)
                if not guard_result.allowed:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Prompt injection detected: {', '.join(guard_result.policy_violations)}",
                    )
                sanitized_query = guard_result.sanitized_text
        else:
            sanitized_query = req.query

        # 2. LangGraph Agent Execution
        with trace.span("langgraph-cyclic-agent") as span:
            initial_state: dict[str, Any] = {
                "query": sanitized_query,
                "current_search_query": sanitized_query,
                "retrieved_chunks": [],
                "entities": [],
                "draft_answer": "",
                "cycle_count": 0,
                "max_cycles": req.max_cycles,
                "is_refusal": False,
                "tenant_id": tenant_id,
                "answer_status": "answered",
                "verification_result": None,
                "timings_ms": {},
                "request_id": request_id,
                "serving_provider": None,
                "serving_model": None,
                "usage": None,
                "debug": {},
            }
            final_state = await agent_graph.ainvoke(
                initial_state,
                config={"configurable": {"top_k": req.top_k}},
            )
            span.set_attribute("cycle_count", final_state["cycle_count"])
            verification_result = final_state.get("verification_result")
            span.set_attribute(
                "verification_status",
                verification_result.status if verification_result else "unchecked",
            )

        # 3. Output Guardrails
        raw_answer = final_state.get("draft_answer", "")
        if output_guardrails_enabled and not final_state.get("is_refusal", False):
            with trace.span("output-guardrails") as span:
                out_result = output_guardrails.evaluate(raw_answer)
                span.set_attribute("allowed", out_result.allowed)
                final_answer = out_result.sanitized_text
                if not out_result.allowed:
                    final_state["answer_status"] = "refused"
                    final_state["is_refusal"] = True
                    final_state["verification_result"] = VerificationSummary(status="unchecked", scope="unchecked")
        else:
            final_answer = raw_answer

        # 4. Record usage only when this request received a provider response.
        if final_state.get("serving_provider"):
            with trace.generation(
                name="generate",
                model=final_state.get("serving_model"),
                provider=final_state.get("serving_provider"),
            ) as gen:
                usage = final_state.get("usage") or {}
                prompt_tokens = usage.get("prompt_tokens", usage.get("input_tokens"))
                completion_tokens = usage.get("completion_tokens", usage.get("output_tokens"))
                if isinstance(prompt_tokens, int) and isinstance(completion_tokens, int):
                    gen.set_tokens(
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        estimated=bool(usage.get("estimated", False)),
                        cost_usd=usage.get("cost_usd"),
                    )

    elapsed_ms = (time.perf_counter() - start_time) * 1000
    timings_ms = dict(final_state.get("timings_ms") or {})
    timings_ms["total"] = elapsed_ms
    provider_value = final_state.get("serving_provider")
    model_value = final_state.get("serving_model")
    if final_state.get("is_refusal", False):
        provider_value, model_value = None, None
    llm_served = bool(provider_value and model_value)

    chunks_data = [
        SearchResult.model_validate(chunk)
        for chunk in final_state.get("retrieved_chunks", [])
    ]
    verification_result = final_state.get("verification_result")
    verification = VerificationSummary.model_validate(
        verification_result.model_dump() if verification_result is not None else {}
    )

    degraded_reason: str | None = final_state.get("generation_error")
    return QueryResponse(
        query=req.query,
        answer=final_answer,
        source_chunks=chunks_data,
        entities=final_state.get("entities", []),
        cycle_count=final_state.get("cycle_count", 1),
        verified=verification.status == "supported",
        refusal=final_state.get("is_refusal", False),
        execution_time_ms=elapsed_ms,
        serving_provider=provider_value,
        serving_model=model_value,
        serving=ServingProvenance(
            provider=provider_value,
            model=model_value,
            fresh=llm_served,
        ),
        degraded_reason=degraded_reason,
        answer_status=final_state.get("answer_status", "answered"),
        verification=verification,
        debug=final_state.get("debug", {}),
        sources=chunks_data,
        request_id=request_id,
        provider=provider_value,
        model=model_value,
        timings_ms=timings_ms,
        usage=final_state.get("usage"),
    )


@app.get("/v1/metrics")
async def get_metrics(tenant_id: str = Depends(require_admin)):
    """Returns aggregated token usage and cost metrics."""
    return tracer.get_tenant_metrics(tenant_id)


@app.get("/v1/index/status", response_model=IndexStatusResponse)
async def get_index_status(tenant_id: str = Depends(require_admin)):
    """Inspects the live index and storage state behind every subsystem.

    Always answers 200 (given valid auth) - a down backend is reported as a
    degraded fallback, because describing degraded state is the point.
    """
    # Same session factory the rest of the platform uses; no new client is built.
    async with AsyncSessionLocal() as db:
        return await build_index_status(
            vector_store=vector_store,
            graph_store=graph_store,
            retriever=retriever,
            db=db,
        )


class TestAndFetchModelsRequest(BaseModel):
    provider: str = Field("openai", description="openai, anthropic, groq, openrouter, deepseek, ollama, or custom")
    api_key: str | None = None
    base_url: str | None = None
    organization_id: str | None = None
    project_id: str | None = None
    model: str | None = None


@app.get("/v1/settings/llm")
async def get_llm_settings(tenant_id: str = Depends(require_admin)):
    """Returns the current LLM configuration (keys never exposed)."""
    resolved = _resolve_active_llm_config_with_secrets()
    provider_names = ("openai", "anthropic", "groq", "openrouter", "deepseek", "ollama", "custom")
    provider_flags = {
        name: bool(getattr(_core_get_settings(), f"{name}_api_key") or _runtime_llm_settings.get(f"{name}_api_key") or name == "ollama")
        for name in provider_names
    }
    if resolved["provider"] in provider_flags and resolved.get("api_key"):
        provider_flags[resolved["provider"]] = True
    # Return all settings EXCEPT api keys - never expose any key information
    safe_settings = {
        "active_provider": resolved["provider"],
        "default_model": resolved["model"],
        "base_url": resolved["base_url"],
        "litellm_base_url": _runtime_llm_settings.get("litellm_base_url"),
        "custom_base_url": _runtime_llm_settings.get("custom_base_url"),
        "provider_models": _runtime_llm_settings.get("provider_models"),
        "provider_available_models": _runtime_llm_settings.get("provider_available_models"),
        # Add configured status for each provider (True/False, no key info)
        "providers_configured": provider_flags,
    }
    return safe_settings


@app.get("/v1/settings/providers")
async def get_providers_status(tenant_id: str = Depends(require_admin)):
    """Returns status and details for all configured and supported LLM providers."""
    active_config = _resolve_active_llm_config_with_secrets()
    active = active_config["provider"].lower()
    provider_configured = {
        name: bool(getattr(_core_get_settings(), f"{name}_api_key") or _runtime_llm_settings.get(f"{name}_api_key") or name == "ollama")
        for name in ("openai", "anthropic", "groq", "openrouter", "deepseek", "ollama", "custom")
    }
    if active in provider_configured and active_config.get("api_key"):
        provider_configured[active] = True
    provider_urls = {
        "openai": _runtime_llm_settings.get("openai_base_url") or "https://api.openai.com/v1",
        "anthropic": _runtime_llm_settings.get("anthropic_base_url") or "https://api.anthropic.com",
        "groq": _runtime_llm_settings.get("groq_base_url") or "https://api.groq.com/openai/v1",
        "openrouter": _runtime_llm_settings.get("openrouter_base_url") or "https://openrouter.ai/api/v1",
        "deepseek": _runtime_llm_settings.get("deepseek_base_url") or "https://api.deepseek.com/v1",
        "ollama": _runtime_llm_settings.get("ollama_base_url") or "http://localhost:11434/v1",
        "custom": _runtime_llm_settings.get("custom_base_url") or "",
    }
    if active in provider_urls:
        provider_urls[active] = active_config["base_url"]
    prov_models = _runtime_llm_settings.get("provider_models", {})

    providers_info = [
        {
            "id": "openai",
            "name": "OpenAI",
            "description": "GPT-4o, GPT-4o-mini, o1, o3-mini",
            "configured": provider_configured["openai"],
            "is_active": active == "openai",
            "base_url": provider_urls["openai"],
            "current_model": active_config["model"] if active == "openai" else prov_models.get("openai", "gpt-4o-mini"),
            "models": ["gpt-4o-mini", "gpt-4o", "o3-mini", "o1"],
            "type": "cloud",
        },
        {
            "id": "anthropic",
            "name": "Anthropic",
            "description": "Claude 3.7 Sonnet, Claude 3.5 Sonnet & Haiku",
            "configured": provider_configured["anthropic"],
            "is_active": active == "anthropic",
            "base_url": provider_urls["anthropic"],
            "current_model": active_config["model"] if active == "anthropic" else prov_models.get("anthropic", "claude-3-5-sonnet-20241022"),
            "models": ["claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
            "type": "cloud",
        },
        {
            "id": "groq",
            "name": "Groq Cloud",
            "description": "Ultra-fast LPU inference (Llama 3.3, Mixtral)",
            "configured": provider_configured["groq"],
            "is_active": active == "groq",
            "base_url": provider_urls["groq"],
            "current_model": active_config["model"] if active == "groq" else prov_models.get("groq", "llama-3.3-70b-versatile"),
            "models": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
            "type": "cloud",
        },
        {
            "id": "openrouter",
            "name": "OpenRouter",
            "description": "Unified routing across 200+ models",
            "configured": provider_configured["openrouter"],
            "is_active": active == "openrouter",
            "base_url": provider_urls["openrouter"],
            "current_model": active_config["model"] if active == "openrouter" else prov_models.get("openrouter", "meta-llama/llama-3.3-70b-instruct"),
            "models": ["meta-llama/llama-3.3-70b-instruct", "openai/gpt-4o", "anthropic/claude-3.5-sonnet", "deepseek/deepseek-chat"],
            "type": "cloud",
        },
        {
            "id": "deepseek",
            "name": "DeepSeek",
            "description": "DeepSeek-V3 & DeepSeek-R1 reasoning models",
            "configured": provider_configured["deepseek"],
            "is_active": active == "deepseek",
            "base_url": provider_urls["deepseek"],
            "current_model": active_config["model"] if active == "deepseek" else prov_models.get("deepseek", "deepseek-chat"),
            "models": ["deepseek-chat", "deepseek-reasoner"],
            "type": "cloud",
        },
        {
            "id": "ollama",
            "name": "Local Ollama",
            "description": "Local offline model execution via Ollama daemon",
            "configured": provider_configured["ollama"],
            "is_active": active == "ollama",
            "base_url": provider_urls["ollama"],
            "current_model": active_config["model"] if active == "ollama" else prov_models.get("ollama", "llama3"),
            "models": ["llama3:latest", "mistral:latest", "qwen2.5:latest"],
            "type": "local",
        },
        {
            "id": "custom",
            "name": "Custom OpenAI-Compatible / Local vLLM",
            "description": "Custom API endpoint (vLLM, LMStudio, TGI, SGLang)",
            "configured": bool(provider_configured["custom"] or (active == "custom" and active_config.get("base_url"))),
            "is_active": active in ["custom", "openai_compatible"],
            "base_url": provider_urls["custom"],
            "current_model": active_config["model"] if active == "custom" else prov_models.get("custom", "llama-3.3-70b-versatile"),
            "models": ["llama-3.3-70b-versatile", "deepseek-chat", "gpt-4o-mini"],
            "type": "custom",
        },
    ]

    return {
        "active_provider": active,
        "providers": providers_info,
    }


@app.post("/v1/settings/llm")
async def update_llm_settings(
    payload: UpdateLLMSettingsRequest,
    tenant_id: str = Depends(require_admin),
):
    """Updates runtime LLM API keys and default model and persists to disk safely."""
    updates = payload.model_dump(exclude_none=True)

    async with _settings_lock:
        selected_provider = (updates.get("active_provider") or _runtime_llm_settings.get("active_provider", "openai")).lower()
        if updates.get("api_key") is not None:
            updates[f"{selected_provider}_api_key"] = updates["api_key"]
        if updates.get("base_url") is not None:
            updates[f"{selected_provider}_base_url"] = updates["base_url"]
        _runtime_llm_settings.update(_merge_preserving_saved(_runtime_llm_settings, updates))

        # Also update provider_models map if default_model and active_provider were supplied
        prov = _runtime_llm_settings.get("active_provider", "openai")
        model = _runtime_llm_settings.get("default_model")
        if prov and model:
            if "provider_models" not in _runtime_llm_settings:
                _runtime_llm_settings["provider_models"] = {}
            _runtime_llm_settings["provider_models"][prov] = model

        _save_persisted_settings(_runtime_llm_settings)

        global agent_graph, llm_client
        llm_client = LiteLLMClient()
        agent_graph = build_rag_agent_graph(
            retriever=retriever,
            graph_store=graph_store,
            llm_client=llm_client,
            llm_config_getter=_resolve_active_llm_config_with_secrets,
            min_dense_score=_core_get_settings().min_dense_score,
            graph_enabled=_core_get_settings().graph_enabled,
            debug_log_prompts=_core_get_settings().debug_log_prompts,
            verify_mode=_core_get_settings().verify_mode,
            tracer=tracer,
        )

    return masked_llm_view(_runtime_llm_settings)


@app.post("/v1/reindex")
async def reindex_endpoint(tenant_id: str = Depends(require_admin)):
    """Rebuilds the vector index from disk chunk records (stop ingestion first)."""
    try:
        manifest = await asyncio.to_thread(ingestion_pipeline.reindex_all)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Reindex failed: {error}") from error
    global _index_consistency
    disk_chunks = len(ingestion_pipeline.storage.load_all_chunks())
    _index_consistency = await asyncio.to_thread(
        check_consistency, _core_get_settings(), await asyncio.to_thread(vector_store.count), disk_chunks
    )
    retriever.update_chunks(vector_store.get_all_chunks(None))
    return {
        "status": "reindexed",
        "chunk_count": manifest.chunk_count,
        "embedding_model": manifest.embedding_model,
        "consistent": _index_consistency.ok,
    }


@app.delete("/v1/documents")
async def clear_all_documents_endpoint(tenant_id: str = Depends(require_admin)):
    """Clears all documents and chunks from dedicated storage and active memory."""
    count = ingestion_pipeline.clear_all()
    retriever.update_chunks(vector_store.get_all_chunks(None))
    return {"status": "cleared", "deleted_count": count, "message": f"All {count} documents removed from storage"}


@app.post("/v1/documents/seed-samples")
async def seed_sample_documents_endpoint(tenant_id: str = Depends(require_admin)):
    """Seeds or resets the default sample documentation into the knowledge base."""
    sample_docs_dir = Path(__file__).parents[2] / "sample_docs"
    count = 0
    if sample_docs_dir.exists():
        for doc_file in sample_docs_dir.glob("*.md"):
            title = doc_file.stem.replace("_", " ").title()
            ingestion_pipeline.ingest_text(
                text=doc_file.read_text(encoding="utf-8", errors="ignore"),
                title=title,
                doc_format=DocumentFormat.MARKDOWN,
                source=str(doc_file.name),
                tenant_id=tenant_id,
            )
            count += 1
    retriever.update_chunks(vector_store.get_all_chunks(None))
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


@app.get("/v1/documents")
async def list_documents_endpoint(tenant_id: str = Depends(require_user)):
    """Lists all stored documents in the permanent knowledge base catalog."""
    return _get_document_list_response(tenant_id)


@app.get("/v1/documents/catalog")
async def catalog_alias_endpoint(tenant_id: str = Depends(require_user)):
    """Alias for document catalog - returns same as /v1/documents for UI compatibility.

    .. deprecated::
        Use :get:`/v1/documents` instead.
    """
    response = _get_document_list_response(tenant_id)
    response["Deprecation"] = "true"
    response["Sunset"] = "2027-01-01"
    return response


@app.get("/v1/documents/{doc_id}/chunks")
async def get_document_chunks_endpoint(
    doc_id: str,
    limit: int = 100,
    offset: int = 0,
    tenant_id: str = Depends(require_user),
):
    """Returns a page of structural chunks for a document with headings and pages."""
    doc = ingestion_pipeline.get_document(doc_id, tenant_id=tenant_id)
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


@app.get("/v1/documents/{doc_id}")
async def get_document_details_endpoint(doc_id: str, tenant_id: str = Depends(require_user)):
    """Retrieves full document metadata and its constituent chunks."""
    doc = ingestion_pipeline.get_document(doc_id, tenant_id=tenant_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found in knowledge base.")
    return doc


@app.delete("/v1/documents/{doc_id}")
async def delete_document_endpoint(doc_id: str, tenant_id: str = Depends(require_user)):
    """Deletes a document and its chunks from vector and graph stores."""
    deleted = ingestion_pipeline.delete_document(doc_id, tenant_id=tenant_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found in knowledge base.")
    retriever.update_chunks(vector_store.get_all_chunks(None))
    return {"status": "deleted", "document_id": doc_id, "message": "Document successfully deleted"}


@app.post("/v1/settings/llm/test-and-fetch-models")
async def test_and_fetch_models(
    req: TestAndFetchModelsRequest,
    tenant_id: str = Depends(require_admin),
):
    """Tests LLM provider API key and dynamically fetches available models from the provider."""
    start_time = time.time()
    models: list[str] = []
    status_msg = ""
    is_success = False

    provider = req.provider.lower()
    api_key = req.api_key or ""
    base_url = req.base_url or ""
    org_id = req.organization_id or ""
    proj_id = req.project_id or ""

    if not api_key and provider not in ["ollama"]:
        return {
            "status": "error",
            "success": False,
            "provider": provider,
            "message": "Missing API Key. Please enter an API key for the selected provider.",
            "latency_ms": 0.0,
            "models": [],
        }

    try:
        transport = _PinnedAsyncHTTPTransport()
        async with httpx.AsyncClient(
            timeout=10.0,
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        ) as client:
            if provider == "openai":
                url = (base_url.rstrip("/") if base_url else "https://api.openai.com/v1") + "/models"
                headers = {"Authorization": f"Bearer {api_key}"}
                if org_id:
                    headers["OpenAI-Organization"] = org_id
                if proj_id:
                    headers["OpenAI-Project"] = proj_id

                resp = await _model_fetch_get(client, transport, provider, url, headers)
                if resp.status_code == 200:
                    data = resp.json()
                    all_ids = [m["id"] for m in data.get("data", [])]
                    models = sorted([
                        m for m in all_ids 
                        if any(p in m for p in ["gpt", "o1", "o3", "text-embedding", "chatgpt"])
                    ])
                    status_msg = f"Successfully authenticated with OpenAI! Fetched {len(models)} models."
                    is_success = True
                elif resp.status_code == 401:
                    status_msg = "Authentication Failed (HTTP 401): The provided OpenAI API key is invalid or expired."
                elif resp.status_code == 403:
                    status_msg = "Access Denied (HTTP 403): Check Organization/Project permissions for this key."
                else:
                    status_msg = f"OpenAI error (HTTP {resp.status_code})."

            elif provider == "anthropic":
                anthro_base = base_url.rstrip("/") if base_url else "https://api.anthropic.com"
                url = anthro_base + ("/models" if anthro_base.endswith("/v1") else "/v1/models")
                headers = {
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                }
                resp = await _model_fetch_get(client, transport, provider, url, headers)
                if resp.status_code == 200:
                    data = resp.json()
                    models = [m["id"] for m in data.get("data", [])]
                    status_msg = f"Successfully authenticated with Anthropic! Fetched {len(models)} models."
                    is_success = True
                elif resp.status_code == 401:
                    status_msg = "Authentication Failed (HTTP 401): The provided Anthropic API key is invalid."
                elif resp.status_code == 404:
                    models = [
                        "claude-3-7-sonnet-20250219",
                        "claude-3-5-sonnet-20241022",
                        "claude-3-5-haiku-20241022",
                        "claude-3-opus-20240229",
                        "claude-3-haiku-20240307",
                    ]
                    status_msg = "Anthropic API Key verified! Loaded standard Claude model suite."
                    is_success = True
                else:
                    status_msg = f"Anthropic error (HTTP {resp.status_code})."

            elif provider == "groq":
                url = (base_url.rstrip("/") if base_url else "https://api.groq.com/openai/v1") + "/models"
                headers = {"Authorization": f"Bearer {api_key}"}
                resp = await _model_fetch_get(client, transport, provider, url, headers)
                if resp.status_code == 200:
                    data = resp.json()
                    models = [m["id"] for m in data.get("data", [])]
                    status_msg = f"Successfully authenticated with Groq Cloud! Fetched {len(models)} models."
                    is_success = True
                elif resp.status_code == 401:
                    status_msg = "Authentication Failed (HTTP 401): The Groq API key is invalid."
                else:
                    status_msg = f"Groq error (HTTP {resp.status_code})."

            elif provider == "openrouter":
                url = (base_url.rstrip("/") if base_url else "https://openrouter.ai/api/v1") + "/models"
                headers = {"Authorization": f"Bearer {api_key}"}
                resp = await _model_fetch_get(client, transport, provider, url, headers)
                if resp.status_code == 200:
                    data = resp.json()
                    models = [m["id"] for m in data.get("data", [])]
                    status_msg = f"Successfully authenticated with OpenRouter! Fetched {len(models)} models."
                    is_success = True
                elif resp.status_code == 401:
                    status_msg = "Authentication Failed (HTTP 401): The OpenRouter API key is invalid."
                else:
                    status_msg = f"OpenRouter error (HTTP {resp.status_code})."

            elif provider == "deepseek":
                url = (base_url.rstrip("/") if base_url else "https://api.deepseek.com/v1") + "/models"
                headers = {"Authorization": f"Bearer {api_key}"}
                resp = await _model_fetch_get(client, transport, provider, url, headers)
                if resp.status_code == 200:
                    data = resp.json()
                    models = [m["id"] for m in data.get("data", [])]
                    status_msg = f"Successfully authenticated with DeepSeek! Fetched {len(models)} models."
                    is_success = True
                elif resp.status_code == 401:
                    status_msg = "Authentication Failed (HTTP 401): The DeepSeek API key is invalid."
                else:
                    status_msg = f"DeepSeek error (HTTP {resp.status_code})."

            elif provider in ["ollama"]:
                target_url = (base_url.rstrip("/") if base_url else "http://localhost:11434") + "/api/tags"
                resp = await _model_fetch_get(client, transport, provider, target_url)
                if resp.status_code == 200:
                    data = resp.json()
                    models = [m["name"] for m in data.get("models", [])]
                    status_msg = f"Successfully connected to local Ollama! Found {len(models)} installed models."
                    is_success = True
                else:
                    status_msg = f"Ollama connection error (HTTP {resp.status_code}). Is Ollama running?"

            elif provider in ["custom", "openai_compatible"]:
                target_url = (base_url.rstrip("/") if base_url else "http://localhost:8000/v1") + "/models"
                headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
                resp = await _model_fetch_get(client, transport, provider, target_url, headers)
                if resp.status_code == 200:
                    data = resp.json()
                    models = [m["id"] for m in data.get("data", [])]
                    status_msg = f"Successfully connected to custom endpoint! Fetched {len(models)} models."
                    is_success = True
                elif resp.status_code == 401:
                    status_msg = "Authentication Failed (HTTP 401): Invalid API key for custom endpoint."
                else:
                    status_msg = f"Endpoint error (HTTP {resp.status_code})."

    except (httpx.HTTPError, httpx.RequestError, OSError, ValueError, KeyError):
        status_msg = f"Connection Failed: Could not reach {provider} endpoint."
        is_success = False

    if is_success and models:
        # Cache successfully verified models & endpoints
        async with _settings_lock:
            if "provider_available_models" not in _runtime_llm_settings:
                _runtime_llm_settings["provider_available_models"] = {}
            _runtime_llm_settings["provider_available_models"][provider] = models
            if api_key and not _is_masked(api_key):
                if provider in ["groq", "openrouter", "deepseek", "custom"]:
                    _runtime_llm_settings["custom_api_key"] = api_key
                _runtime_llm_settings[f"{provider}_api_key"] = api_key
            if base_url and provider in ["openai", "anthropic", "groq", "openrouter", "deepseek", "ollama", "custom"] and not _is_masked(base_url):
                _runtime_llm_settings[f"{provider}_base_url"] = base_url
            _save_persisted_settings(_runtime_llm_settings)

    elapsed_ms = (time.time() - start_time) * 1000

    return {
        "status": "success" if is_success else "error",
        "success": is_success,
        "provider": provider,
        "message": status_msg,
        "latency_ms": elapsed_ms,
        "models": models,
        "listing_only": True,
    }


@app.post("/v1/settings/test")
@app.post("/v1/settings/llm/test")
async def test_llm_connection(tenant_id: str = Depends(require_admin)):
    """Runs a one-token generation to verify active provider credentials and endpoint."""
    start = time.time()
    config = _resolve_active_llm_config_with_secrets()
    provider = config["provider"]
    model = config["model"]
    try:
        await llm_client.chat_completion(
            messages=[{"role": "user", "content": "Reply with OK."}],
            model=model,
            max_tokens=1,
            temperature=0,
            provider=provider,
            api_key=config["api_key"],
            base_url=config["base_url"],
        )
        is_success = True
        status_msg = f"Successfully generated a test token with {model} via {provider}"
    except ProviderError as e:
        is_success = False
        status_msg = e.message

    latency = (time.time() - start) * 1000
    return {
        "status": "success" if is_success else "error",
        "message": status_msg,
        "latency_ms": latency,
    }


# Mount Web UI frontend if built
web_dist = Path(__file__).parents[2] / "web" / "dist"
if web_dist.exists():
    app.mount("/", StaticFiles(directory=str(web_dist), html=True), name="web")

