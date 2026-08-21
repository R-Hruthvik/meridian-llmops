"""Unified Meridian RAG Engine & LLMOps FastAPI Application."""

import json
import logging
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from packages.core.models import (
    DocumentFormat,
    QueryRequest,
    QueryResponse,
    SearchResult,
)
from services.gateway.auth import verify_api_key
from services.gateway.client import LiteLLMClient
from services.gateway.guardrails.input_rails import InputGuardrails
from services.gateway.guardrails.output_rails import OutputGuardrails
from services.ingestion.graph_store import KnowledgeGraphStore
from services.ingestion.pipeline import IngestionPipeline
from services.ingestion.vector_store import VectorStoreManager
from services.rag_engine.agent.graph import build_rag_agent_graph
from services.rag_engine.observability.langfuse_client import MeridianTracer
from services.rag_engine.retrieval.hybrid import HybridRetriever

app = FastAPI(
    title="Meridian LLMOps RAG Engine",
    version="0.1.0",
    description="Production-grade Self-Healing Agentic RAG Platform with Guardrails and Tracing",
)

# Core singletons
vector_store = VectorStoreManager(in_memory=True)
graph_store = KnowledgeGraphStore(in_memory=True)
ingestion_pipeline = IngestionPipeline(vector_store=vector_store, graph_store=graph_store)
retriever = HybridRetriever(vector_store=vector_store)
input_guardrails = InputGuardrails()
output_guardrails = OutputGuardrails()
tracer = MeridianTracer()
llm_client = LiteLLMClient()

logger = logging.getLogger("meridian.rag_engine")

# Persistent runtime LLM settings
SETTINGS_FILE = Path(__file__).parents[2] / ".meridian_settings.json"

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
    "custom_base_url": "https://api.groq.com/openai/v1",
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
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                settings.update(saved)
        except (OSError, ValueError, TypeError) as e:
            logger.warning(f"Could not load settings file: {e}")
    return settings

def _save_persisted_settings(settings: dict[str, Any]) -> None:
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2)
    except (OSError, ValueError, TypeError) as e:
        logger.warning(f"Could not save settings file: {e}")

_runtime_llm_settings: dict[str, Any] = _load_persisted_settings()


def get_active_llm_config() -> dict[str, Any]:
    """Resolves active provider credentials, endpoints, and exact model dynamically."""
    provider = _runtime_llm_settings.get("active_provider", "openai").lower()
    provider_models = _runtime_llm_settings.get("provider_models", {})
    configured_model = _runtime_llm_settings.get("default_model")

    if provider == "groq":
        if configured_model and not configured_model.startswith(("gpt-", "claude-", "o1", "o3")):
            model = configured_model
        else:
            model = provider_models.get("groq", "groq/compound-mini")
        api_key = _runtime_llm_settings.get("groq_api_key") or _runtime_llm_settings.get("custom_api_key")
        base_url = _runtime_llm_settings.get("custom_base_url") or "https://api.groq.com/openai/v1"
    elif provider == "openai":
        if configured_model and configured_model.startswith(("gpt-", "o1", "o3", "chatgpt")):
            model = configured_model
        else:
            model = provider_models.get("openai", "gpt-4o-mini")
        api_key = _runtime_llm_settings.get("openai_api_key")
        base_url = "https://api.openai.com/v1"
    elif provider == "anthropic":
        if configured_model and configured_model.startswith("claude-"):
            model = configured_model
        else:
            model = provider_models.get("anthropic", "claude-3-5-sonnet-20241022")
        api_key = _runtime_llm_settings.get("anthropic_api_key")
        base_url = "https://api.anthropic.com/v1"
    elif provider == "openrouter":
        model = configured_model or provider_models.get("openrouter", "meta-llama/llama-3.3-70b-instruct")
        api_key = _runtime_llm_settings.get("openrouter_api_key") or _runtime_llm_settings.get("custom_api_key")
        base_url = _runtime_llm_settings.get("custom_base_url") or "https://openrouter.ai/api/v1"
    elif provider == "deepseek":
        model = configured_model or provider_models.get("deepseek", "deepseek-chat")
        api_key = _runtime_llm_settings.get("deepseek_api_key") or _runtime_llm_settings.get("custom_api_key")
        base_url = _runtime_llm_settings.get("custom_base_url") or "https://api.deepseek.com/v1"
    elif provider in ["custom", "openai_compatible"]:
        model = configured_model or "groq/compound-mini"
        api_key = _runtime_llm_settings.get("custom_api_key")
        base_url = _runtime_llm_settings.get("custom_base_url", "https://api.groq.com/openai/v1")
    elif provider == "ollama":
        model = configured_model or provider_models.get("ollama", "llama3:latest")
        api_key = None
        base_url = _runtime_llm_settings.get("custom_base_url") or "http://localhost:11434/v1"
    else:
        model = configured_model or "gpt-4o-mini"
        api_key = None
        base_url = _runtime_llm_settings.get("litellm_base_url", "http://localhost:4000")

    return {
        "provider": provider,
        "model": model,
        "api_key": api_key,
        "base_url": base_url,
    }


# Hydrate knowledge base from dedicated storage; auto-seed sample_docs on cold-start (0 chunks)
_docs_loaded = ingestion_pipeline.load_persisted_knowledge_base()
if _docs_loaded == 0 or len(vector_store.get_all_chunks()) == 0:
    # Cold-start: hydrate returned 0 → seed sample_docs via pipeline.ingest_text
    sample_docs_dir = Path(__file__).parents[2] / "sample_docs"
    if sample_docs_dir.exists():
        for doc_file in sample_docs_dir.glob("*.md"):
            try:
                title = doc_file.stem.replace("_", " ").title()
                ingestion_pipeline.ingest_text(
                    text=doc_file.read_text(encoding="utf-8", errors="ignore"),
                    title=title,
                    doc_format=DocumentFormat.MARKDOWN,
                    source=str(doc_file.name),
                )
            except (OSError, ValueError) as e:
                logger.warning("Cold-start seed failed for %s: %s", doc_file, e)
    # Fallback: ensure at least one chunk exists if sample_docs empty
    if len(vector_store.get_all_chunks()) == 0:
        ingestion_pipeline.ingest_text(
            text="Meridian platform uses Qdrant for dense vector similarity and Neo4j for Knowledge Graph entity relationships.",
            title="Meridian System Architecture",
            doc_format=DocumentFormat.MARKDOWN,
            source="cold_start_seed.md",
        )
retriever.update_chunks(vector_store.get_all_chunks())
agent_graph = build_rag_agent_graph(
    retriever=retriever,
    graph_store=graph_store,
    llm_client=llm_client,
    llm_config_getter=get_active_llm_config,
)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "meridian-rag-engine"}


@app.post("/v1/ingest")
async def ingest_document_endpoint(
    payload: dict[str, Any],
    tenant_id: str = Depends(verify_api_key),
):
    """Ingests text or documents into dedicated disk storage, Qdrant vector store, and Neo4j knowledge graph."""
    text = payload.get("text", "")
    title = payload.get("title", "Uploaded Document")
    source = payload.get("source", "manual")
    if not text.strip():
        raise HTTPException(status_code=400, detail="Document text cannot be empty.")

    result = ingestion_pipeline.ingest_text(text=text, title=title, source=source)
    retriever.update_chunks(vector_store.get_all_chunks())
    return result


@app.post("/v1/query", response_model=QueryResponse)
async def query_endpoint(
    req: QueryRequest,
    tenant_id: str = Depends(verify_api_key),
):
    """Executes the self-healing Agentic RAG pipeline with guardrails and tracing."""
    start_time = time.time()
    trace_ctx = tracer.trace(name="rag-query-pipeline", tenant_id=tenant_id)

    with trace_ctx as trace:
        # 1. Input Guardrails
        if req.enforce_guardrails:
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
                "critic_verdict": None,
                "cycle_count": 0,
                "max_cycles": req.max_cycles,
                "is_grounded": False,
                "is_refusal": False,
                "tenant_id": tenant_id,
            }
            final_state = await agent_graph.ainvoke(initial_state)
            span.set_attribute("cycle_count", final_state["cycle_count"])
            span.set_attribute("is_grounded", final_state["is_grounded"])

        # 3. Output Guardrails
        raw_answer = final_state.get("draft_answer", "")
        if req.enforce_guardrails and not final_state.get("is_refusal", False):
            with trace.span("output-guardrails") as span:
                out_result = output_guardrails.evaluate(raw_answer)
                span.set_attribute("allowed", out_result.allowed)
                final_answer = out_result.sanitized_text
        else:
            final_answer = raw_answer

        # 4. Record LLM generation span
        with trace.generation(name="critic-agent-llm") as gen:
            gen.set_tokens(
                prompt_tokens=len(req.query.split()) + 50,
                completion_tokens=len(final_answer.split()),
            )

    elapsed_ms = (time.time() - start_time) * 1000
    active_cfg = get_active_llm_config()

    chunks_data = [
        SearchResult(
            chunk_id=c.get("chunk_id", "c"),
            document_id=c.get("document_id", "d"),
            text=c.get("text", ""),
            score=c.get("score", 1.0),
            retrieval_method="hybrid_rrf",
        )
        for c in final_state.get("retrieved_chunks", [])
    ]

    return QueryResponse(
        query=req.query,
        answer=final_answer,
        source_chunks=chunks_data,
        cycle_count=final_state.get("cycle_count", 1),
        verified=final_state.get("is_grounded", False),
        refusal=final_state.get("is_refusal", False),
        execution_time_ms=elapsed_ms,
        serving_provider=active_cfg.get("provider", "openai"),
        serving_model=active_cfg.get("model", "gpt-4o-mini"),
    )


@app.get("/v1/metrics")
async def get_metrics(tenant_id: str = Depends(verify_api_key)):
    """Returns aggregated token usage and cost metrics."""
    return tracer.get_tenant_metrics(tenant_id)


class TestAndFetchModelsRequest(BaseModel):
    provider: str = Field("openai", description="openai, anthropic, groq, openrouter, deepseek, ollama, or custom")
    api_key: str | None = None
    base_url: str | None = None
    organization_id: str | None = None
    project_id: str | None = None
    model: str | None = None


@app.get("/v1/settings/llm")
async def get_llm_settings(tenant_id: str = Depends(verify_api_key)):
    """Returns the current LLM configuration and active model."""
    masked = _runtime_llm_settings.copy()
    for key_name in ["openai_api_key", "anthropic_api_key", "groq_api_key", "openrouter_api_key", "deepseek_api_key", "custom_api_key"]:
        if masked.get(key_name):
            val = str(masked[key_name])
            masked[key_name] = val[:7] + "..." + val[-4:] if len(val) > 11 else "***"
    return masked


@app.get("/v1/settings/providers")
async def get_providers_status(tenant_id: str = Depends(verify_api_key)):
    """Returns status and details for all configured and supported LLM providers."""
    active = _runtime_llm_settings.get("active_provider", "openai").lower()
    custom_url = _runtime_llm_settings.get("custom_base_url", "https://api.groq.com/openai/v1")
    prov_models = _runtime_llm_settings.get("provider_models", {})

    providers_info = [
        {
            "id": "openai",
            "name": "OpenAI",
            "description": "GPT-4o, GPT-4o-mini, o1, o3-mini",
            "configured": bool(_runtime_llm_settings.get("openai_api_key")),
            "is_active": active == "openai",
            "base_url": "https://api.openai.com/v1",
            "current_model": _runtime_llm_settings.get("default_model") if active == "openai" else prov_models.get("openai", "gpt-4o-mini"),
            "models": ["gpt-4o-mini", "gpt-4o", "o3-mini", "o1"],
            "type": "cloud",
        },
        {
            "id": "anthropic",
            "name": "Anthropic",
            "description": "Claude 3.7 Sonnet, Claude 3.5 Sonnet & Haiku",
            "configured": bool(_runtime_llm_settings.get("anthropic_api_key")),
            "is_active": active == "anthropic",
            "base_url": "https://api.anthropic.com/v1",
            "current_model": _runtime_llm_settings.get("default_model") if active == "anthropic" else prov_models.get("anthropic", "claude-3-5-sonnet-20241022"),
            "models": ["claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
            "type": "cloud",
        },
        {
            "id": "groq",
            "name": "Groq Cloud",
            "description": "Ultra-fast LPU inference (Llama 3.3, Mixtral)",
            "configured": bool(_runtime_llm_settings.get("groq_api_key") or _runtime_llm_settings.get("custom_api_key")),
            "is_active": active == "groq",
            "base_url": _runtime_llm_settings.get("custom_base_url") or "https://api.groq.com/openai/v1",
            "current_model": _runtime_llm_settings.get("default_model") if active == "groq" else prov_models.get("groq", "llama-3.3-70b-versatile"),
            "models": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
            "type": "cloud",
        },
        {
            "id": "openrouter",
            "name": "OpenRouter",
            "description": "Unified routing across 200+ models",
            "configured": bool(_runtime_llm_settings.get("openrouter_api_key") or _runtime_llm_settings.get("custom_api_key")),
            "is_active": active == "openrouter",
            "base_url": "https://openrouter.ai/api/v1",
            "current_model": _runtime_llm_settings.get("default_model") if active == "openrouter" else prov_models.get("openrouter", "meta-llama/llama-3.3-70b-instruct"),
            "models": ["meta-llama/llama-3.3-70b-instruct", "openai/gpt-4o", "anthropic/claude-3.5-sonnet", "deepseek/deepseek-chat"],
            "type": "cloud",
        },
        {
            "id": "deepseek",
            "name": "DeepSeek",
            "description": "DeepSeek-V3 & DeepSeek-R1 reasoning models",
            "configured": bool(_runtime_llm_settings.get("deepseek_api_key") or _runtime_llm_settings.get("custom_api_key")),
            "is_active": active == "deepseek",
            "base_url": "https://api.deepseek.com/v1",
            "current_model": _runtime_llm_settings.get("default_model") if active == "deepseek" else prov_models.get("deepseek", "deepseek-chat"),
            "models": ["deepseek-chat", "deepseek-reasoner"],
            "type": "cloud",
        },
        {
            "id": "ollama",
            "name": "Local Ollama",
            "description": "Local offline model execution via Ollama daemon",
            "configured": True,
            "is_active": active == "ollama",
            "base_url": "http://localhost:11434",
            "current_model": _runtime_llm_settings.get("default_model") if active == "ollama" else prov_models.get("ollama", "llama3"),
            "models": ["llama3:latest", "mistral:latest", "qwen2.5:latest"],
            "type": "local",
        },
        {
            "id": "custom",
            "name": "Custom OpenAI-Compatible / Local vLLM",
            "description": "Custom API endpoint (vLLM, LMStudio, TGI, SGLang)",
            "configured": bool(_runtime_llm_settings.get("custom_base_url") or _runtime_llm_settings.get("custom_api_key")),
            "is_active": active in ["custom", "openai_compatible"],
            "base_url": custom_url,
            "current_model": _runtime_llm_settings.get("default_model") if active in ["custom", "openai_compatible"] else prov_models.get("custom", "llama-3.3-70b-versatile"),
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
    payload: dict[str, Any],
    tenant_id: str = Depends(verify_api_key),
):
    """Updates runtime LLM API keys and default model and persists to disk safely."""
    for k, v in payload.items():
        if v is not None:
            # If the value is a masked string or empty string for an existing saved key, do not overwrite!
            if isinstance(v, str):
                if "..." in v or v == "***":
                    continue
                if v == "" and k.endswith("_api_key") and _runtime_llm_settings.get(k):
                    # Preserve existing API key if user left field blank
                    continue
            _runtime_llm_settings[k] = v

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
        llm_config_getter=get_active_llm_config,
    )

    return _runtime_llm_settings


@app.delete("/v1/documents")
async def clear_all_documents_endpoint(tenant_id: str = Depends(verify_api_key)):
    """Clears all documents and chunks from dedicated storage and active memory."""
    count = ingestion_pipeline.clear_all()
    retriever.update_chunks(vector_store.get_all_chunks())
    return {"status": "cleared", "deleted_count": count, "message": f"All {count} documents removed from storage"}


@app.post("/v1/documents/seed-samples")
async def seed_sample_documents_endpoint(tenant_id: str = Depends(verify_api_key)):
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
            )
            count += 1
    retriever.update_chunks(vector_store.get_all_chunks())
    return {"status": "seeded", "documents_seeded": count}


@app.get("/v1/documents")
async def list_documents_endpoint(tenant_id: str = Depends(verify_api_key)):
    """Lists all stored documents in the permanent knowledge base catalog."""
    docs = ingestion_pipeline.get_documents()
    total_chunks = sum(d.get("chunk_count", 0) for d in docs)
    total_entities = sum(d.get("entities_count", 0) for d in docs)
    return {
        "total_documents": len(docs),
        "total_chunks": total_chunks,
        "total_entities": total_entities,
        "documents": docs,
    }


@app.get("/v1/documents/{doc_id}")
async def get_document_details_endpoint(doc_id: str, tenant_id: str = Depends(verify_api_key)):
    """Retrieves full document metadata and its constituent chunks."""
    doc = ingestion_pipeline.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found in knowledge base.")
    return doc


@app.delete("/v1/documents/{doc_id}")
async def delete_document_endpoint(doc_id: str, tenant_id: str = Depends(verify_api_key)):
    """Deletes a document and its chunks from vector and graph stores."""
    deleted = ingestion_pipeline.delete_document(doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found in knowledge base.")
    retriever.update_chunks(vector_store.get_all_chunks())
    return {"status": "deleted", "document_id": doc_id, "message": "Document successfully deleted"}


@app.post("/v1/settings/llm/test-and-fetch-models")
async def test_and_fetch_models(
    req: TestAndFetchModelsRequest,
    tenant_id: str = Depends(verify_api_key),
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
        async with httpx.AsyncClient(timeout=10.0) as client:
            if provider == "openai":
                url = "https://api.openai.com/v1/models"
                headers = {"Authorization": f"Bearer {api_key}"}
                if org_id:
                    headers["OpenAI-Organization"] = org_id
                if proj_id:
                    headers["OpenAI-Project"] = proj_id

                resp = await client.get(url, headers=headers)
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
                    status_msg = f"OpenAI error (HTTP {resp.status_code}): {resp.text[:100]}"

            elif provider == "anthropic":
                url = "https://api.anthropic.com/v1/models"
                headers = {
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                }
                resp = await client.get(url, headers=headers)
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
                    status_msg = f"Anthropic error (HTTP {resp.status_code}): {resp.text[:100]}"

            elif provider == "groq":
                url = "https://api.groq.com/openai/v1/models"
                headers = {"Authorization": f"Bearer {api_key}"}
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    models = [m["id"] for m in data.get("data", [])]
                    status_msg = f"Successfully authenticated with Groq Cloud! Fetched {len(models)} models."
                    is_success = True
                elif resp.status_code == 401:
                    status_msg = "Authentication Failed (HTTP 401): The Groq API key is invalid."
                else:
                    status_msg = f"Groq error (HTTP {resp.status_code}): {resp.text[:100]}"

            elif provider == "openrouter":
                url = "https://openrouter.ai/api/v1/models"
                headers = {"Authorization": f"Bearer {api_key}"}
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    models = [m["id"] for m in data.get("data", [])]
                    status_msg = f"Successfully authenticated with OpenRouter! Fetched {len(models)} models."
                    is_success = True
                elif resp.status_code == 401:
                    status_msg = "Authentication Failed (HTTP 401): The OpenRouter API key is invalid."
                else:
                    status_msg = f"OpenRouter error (HTTP {resp.status_code}): {resp.text[:100]}"

            elif provider == "deepseek":
                url = "https://api.deepseek.com/v1/models"
                headers = {"Authorization": f"Bearer {api_key}"}
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    models = [m["id"] for m in data.get("data", [])]
                    status_msg = f"Successfully authenticated with DeepSeek! Fetched {len(models)} models."
                    is_success = True
                elif resp.status_code == 401:
                    status_msg = "Authentication Failed (HTTP 401): The DeepSeek API key is invalid."
                else:
                    status_msg = f"DeepSeek error (HTTP {resp.status_code}): {resp.text[:100]}"

            elif provider in ["ollama"]:
                target_url = (base_url.rstrip("/") if base_url else "http://localhost:11434") + "/api/tags"
                resp = await client.get(target_url)
                if resp.status_code == 200:
                    data = resp.json()
                    models = [m["name"] for m in data.get("models", [])]
                    status_msg = f"Successfully connected to local Ollama! Found {len(models)} installed models."
                    is_success = True
                else:
                    status_msg = f"Ollama connection error (HTTP {resp.status_code}). Is Ollama running on {target_url}?"

            elif provider in ["custom", "openai_compatible"]:
                target_url = (base_url.rstrip("/") if base_url else "http://localhost:8000/v1") + "/models"
                headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
                resp = await client.get(target_url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    models = [m["id"] for m in data.get("data", [])]
                    status_msg = f"Successfully connected to custom endpoint! Fetched {len(models)} models."
                    is_success = True
                elif resp.status_code == 401:
                    status_msg = "Authentication Failed (HTTP 401): Invalid API key for custom endpoint."
                else:
                    status_msg = f"Endpoint error (HTTP {resp.status_code}): {resp.text[:100]}"

    except (httpx.HTTPError, httpx.RequestError, OSError, ValueError, KeyError) as e:
        status_msg = f"Connection Failed: Could not reach {provider} endpoint ({str(e)[:80]})"
        is_success = False

    if is_success and models:
        # Cache successfully verified models & endpoints
        if "provider_available_models" not in _runtime_llm_settings:
            _runtime_llm_settings["provider_available_models"] = {}
        _runtime_llm_settings["provider_available_models"][provider] = models
        if api_key:
            if provider in ["groq", "openrouter", "deepseek", "custom"]:
                _runtime_llm_settings["custom_api_key"] = api_key
            _runtime_llm_settings[f"{provider}_api_key"] = api_key
        if base_url and provider in ["groq", "openrouter", "deepseek", "custom"]:
            _runtime_llm_settings["custom_base_url"] = base_url
        _save_persisted_settings(_runtime_llm_settings)

    elapsed_ms = (time.time() - start_time) * 1000

    return {
        "status": "success" if is_success else "error",
        "success": is_success,
        "provider": provider,
        "message": status_msg,
        "latency_ms": elapsed_ms,
        "models": models,
    }


@app.post("/v1/settings/llm/test")
async def test_llm_connection(tenant_id: str = Depends(verify_api_key)):
    """Tests LLM provider connectivity with a test ping."""
    start = time.time()
    provider = _runtime_llm_settings.get("active_provider", "openai").lower()
    config = get_active_llm_config()
    api_key = config.get("api_key", "")
    base_url = config.get("base_url", "https://api.openai.com/v1")
    model = config.get("model", "gpt-4o-mini")
    endpoint = f"{base_url.rstrip('/')}/models"

    status_msg = f"Successfully connected to {model} via {provider}"
    is_success = True

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers: dict[str, str] = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            resp = await client.get(
                endpoint,
                headers=headers,
            )
            if resp.status_code != 200:
                status_msg = f"Endpoint error (HTTP {resp.status_code})"
                is_success = False
    except (httpx.HTTPError, httpx.RequestError, OSError) as e:
        status_msg = f"Connection Failed: {str(e)[:80]}"
        is_success = False

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

