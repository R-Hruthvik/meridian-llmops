"""LLM settings router: provider config, connectivity tests, and model listing.

Split out of :mod:`services.rag_engine.routers.api`. Shared service singletons
and helpers are resolved through the aggregation module at call time via
:class:`LiveRef`, so the test suite's monkeypatches on ``routers.api`` keep
taking effect.
"""

import asyncio
import time
from typing import Any, cast

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from packages.core.errors import ProviderError
from packages.core.models import UpdateLLMSettingsRequest
from services.gateway.client import LiteLLMClient
from services.gateway.safe_http import (
    PinnedAsyncHTTPTransport as _PinnedAsyncHTTPTransport,
)
from services.rag_engine.agent.graph import build_rag_agent_graph
from services.rag_engine.deps import require_admin
from services.rag_engine.routers._state import (
    _active_services,
    _is_masked,
    _merge_preserving_saved,
    _model_fetch_get,
    _resolve_active_llm_config_with_secrets,
    _save_persisted_settings,
    _settings,
    _settings_lock,
    graph_store_ref,
    llm_client_ref,
    masked_llm_view,
    retriever_ref,
    runtime_llm_settings_ref,
    tracer_ref,
)

router = APIRouter()

# Resolve shared services through the aggregation module at call time so tests
# that rebind ``routers.api.<name>`` are honoured.
graph_store: Any = graph_store_ref
retriever: Any = retriever_ref
llm_client: Any = llm_client_ref
tracer: Any = tracer_ref
_runtime_llm_settings = runtime_llm_settings_ref


class TestAndFetchModelsRequest(BaseModel):
    provider: str = Field("openai", description="openai, anthropic, groq, openrouter, deepseek, ollama, or custom")
    api_key: str | None = None
    base_url: str | None = None
    organization_id: str | None = None
    project_id: str | None = None
    model: str | None = None


@router.get("/v1/settings/llm")
async def get_llm_settings(tenant_id: str = Depends(require_admin)):
    """Returns the current LLM configuration (keys never exposed)."""
    resolved = _resolve_active_llm_config_with_secrets()
    provider_names = ("openai", "anthropic", "groq", "openrouter", "deepseek", "ollama", "custom")
    provider_flags = {
        name: bool(getattr(_settings, f"{name}_api_key") or _runtime_llm_settings.get(f"{name}_api_key") or name == "ollama")
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


@router.get("/v1/settings/providers")
async def get_providers_status(tenant_id: str = Depends(require_admin)):
    """Returns status and details for all configured and supported LLM providers."""
    active_config = _resolve_active_llm_config_with_secrets()
    active = active_config["provider"].lower()
    provider_configured = {
        name: bool(getattr(_settings, f"{name}_api_key") or _runtime_llm_settings.get(f"{name}_api_key") or name == "ollama")
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


@router.post("/v1/settings/llm")
async def update_llm_settings(
    payload: UpdateLLMSettingsRequest,
    tenant_id: str = Depends(require_admin),
):
    """Updates runtime LLM API keys and default model and persists to disk safely."""
    updates = payload.model_dump(exclude_none=True)

    async with _settings_lock:
        if "active_provider" in updates and updates.get("active_provider") is not None:
            candidate = str(updates["active_provider"]).lower()
            if candidate not in {"openai", "anthropic", "groq", "openrouter", "deepseek", "ollama", "custom", "openai_compatible", "litellm"}:
                raise HTTPException(status_code=400, detail=f"Unsupported active_provider: {candidate}")
        selected_provider = (updates.get("active_provider") or _runtime_llm_settings.get("active_provider", "openai")).lower()
        if updates.get("api_key") is not None:
            updates[f"{selected_provider}_api_key"] = updates["api_key"]
        if updates.get("base_url") is not None:
            updates[f"{selected_provider}_base_url"] = updates["base_url"]
        # Never persist or return the submitted key under the generic ``api_key`` key.
        updates.pop("api_key", None)
        updates.pop("base_url", None)
        merged = _merge_preserving_saved(dict(_runtime_llm_settings), updates)
        # Drop any legacy generic key that may have leaked into runtime settings.
        merged.pop("api_key", None)
        _runtime_llm_settings.clear()
        _runtime_llm_settings.update(merged)

        # Also update provider_models map if default_model and active_provider were supplied
        prov = str(_runtime_llm_settings.get("active_provider", "openai")).lower()
        model = _runtime_llm_settings.get("default_model")
        if prov and model:
            if "provider_models" not in _runtime_llm_settings:
                _runtime_llm_settings["provider_models"] = {}
            _runtime_llm_settings["provider_models"][prov] = model
        # Normalize provider_models keys to supported providers (lowercase).
        supported = {"openai", "anthropic", "groq", "openrouter", "deepseek", "ollama", "custom", "litellm", "openai_compatible"}
        pm = _runtime_llm_settings.get("provider_models")
        if isinstance(pm, dict):
            _runtime_llm_settings["provider_models"] = {
                str(k).lower(): v for k, v in pm.items() if str(k).lower() in supported
            }

        await asyncio.to_thread(_save_persisted_settings, dict(_runtime_llm_settings))

        new_llm_client = LiteLLMClient(allow_private_provider_urls=_settings.allow_private_provider_urls)
        llm_client = new_llm_client
        try:
            import services.rag_engine.routers.api as _api

            _api.llm_client = new_llm_client  # type: ignore[assignment]
        except (ImportError, RuntimeError):
            pass
        new_agent_graph = build_rag_agent_graph(
            retriever=retriever,
            graph_store=cast(Any, graph_store),
            llm_client=llm_client,
            llm_config_getter=_resolve_active_llm_config_with_secrets,
            min_dense_score=_settings.min_dense_score,
            graph_enabled=_settings.graph_enabled,
            graph_context_enabled=_settings.graph_context_enabled,
            debug_log_prompts=_settings.debug_log_prompts,
            verify_mode=_settings.verify_mode,
            tracer=tracer,
        )
        active = _active_services.get()
        if active is not None:
            active["llm_client"] = new_llm_client
            active["agent_graph"] = new_agent_graph
        # Invalidate cached default services so stale clients are not reused.
        try:
            import services.rag_engine.routers.api as _api

            _api._default_service_cache = None
        except (ImportError, RuntimeError):
            pass

    return masked_llm_view(dict(_runtime_llm_settings))


@router.post("/v1/settings/llm/test-and-fetch-models")
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

    except (httpx.HTTPError, httpx.RequestError, OSError, ValueError, KeyError) as exc:
        detail = str(exc).strip()
        if detail:
            status_msg = f"Connection Failed: Could not reach {provider} endpoint ({detail})."
        else:
            status_msg = f"Connection Failed: Could not reach {provider} endpoint."
        is_success = False

    if is_success and models:
        # Cache successfully verified models & endpoints
        async with _settings_lock:
            if "provider_available_models" not in _runtime_llm_settings:
                _runtime_llm_settings["provider_available_models"] = {}
            _runtime_llm_settings["provider_available_models"][provider] = models
            if api_key and not _is_masked(api_key):
                _runtime_llm_settings[f"{provider}_api_key"] = api_key
            if base_url and provider in ["openai", "anthropic", "groq", "openrouter", "deepseek", "ollama", "custom"] and not _is_masked(base_url):
                _runtime_llm_settings[f"{provider}_base_url"] = base_url
            await asyncio.to_thread(_save_persisted_settings, dict(_runtime_llm_settings))

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


@router.post("/v1/settings/test")
@router.post("/v1/settings/llm/test")
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
            max_tokens=256,
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
    except Exception as e:  # noqa: BLE001
        is_success = False
        status_msg = f"Connection failed: {e}"

    latency = (time.time() - start) * 1000
    return {
        "status": "success" if is_success else "error",
        "message": status_msg,
        "latency_ms": latency,
    }
