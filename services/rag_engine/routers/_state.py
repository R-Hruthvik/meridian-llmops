"""Shared runtime state and the dependency seam for the RAG engine routers.

Route handlers were historically defined in a single module
(:mod:`services.rag_engine.routers.api`), and the test suite monkeypatches that
module's globals (``vector_store``, ``agent_graph``, ``_core_get_settings`` ...).
To split the module into sub-routers without breaking those seams, moved code
resolves shared names through the aggregation module at call time via
:func:`live` / :class:`LiveRef` instead of capturing them at import time.

The mutable singletons themselves live here: the service proxies that resolve
the active application's services, and the persistent runtime LLM settings.
"""

import asyncio
import json
import logging
import os
from collections.abc import MutableMapping
from contextvars import ContextVar
from pathlib import Path
from types import ModuleType
from typing import Any, cast

import httpx
from fastapi import Request, status
from fastapi.responses import JSONResponse

from packages.core.secrets_store import SECRET_SUFFIX, load_secrets, save_secrets
from services.gateway.safe_http import (
    PinnedAsyncHTTPTransport as _PinnedAsyncHTTPTransport,
)
from services.gateway.safe_http import (
    ProviderURLNotAllowed,
    validate_provider_url,
)
from services.ingestion import storage as ingestion_storage

logger = logging.getLogger("meridian.rag_engine")
_api_module: ModuleType | None = None


def bind_api_module(module: ModuleType) -> None:
    """Bind the compatibility module without importing it from this state leaf."""
    global _api_module
    _api_module = module


def set_live_value(name: str, value: Any) -> None:
    if _api_module is None:
        raise RuntimeError("RAG router API module is not initialized")
    setattr(_api_module, name, value)


def live(name: str) -> Any:
    """Return the current value of ``name`` on the aggregation module.

    The API module is registered during assembly. Keeping a module reference
    avoids making this low-level state module import the application assembly.
    """
    if _api_module is None:
        raise RuntimeError("RAG router API module is not initialized")
    return getattr(_api_module, name)


class LiveRef:
    """Resolve ``routers.api.<name>`` on every attribute access or call.

    Handlers in the split routers hold a ``LiveRef`` for each shared service, so
    a monkeypatch on the aggregation module still takes effect while the handler
    body (which uses the bare name) stays unchanged.
    """

    __slots__ = ("_name",)

    def __init__(self, name: str) -> None:
        object.__setattr__(self, "_name", name)

    def _target(self) -> Any:
        return live(self._name)

    def __getattr__(self, item: str) -> Any:
        return getattr(self._target(), item)

    def __setattr__(self, key: str, value: Any) -> None:
        setattr(self._target(), key, value)

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        return self._target()(*args, **kwargs)

    def __getitem__(self, key: Any) -> Any:
        return self._target()[key]

    def __setitem__(self, key: Any, value: Any) -> None:
        self._target()[key] = value

    def __delitem__(self, key: Any) -> None:
        del self._target()[key]

    def __contains__(self, key: object) -> bool:
        return key in self._target()

    def __iter__(self):
        return iter(self._target())

    def __len__(self) -> int:
        return len(self._target())


index_gate_ref = LiveRef("_index_gate")
vector_store_ref = LiveRef("vector_store")
graph_store_ref = LiveRef("graph_store")
ingestion_pipeline_ref = LiveRef("ingestion_pipeline")
retriever_ref = LiveRef("retriever")
tracer_ref = LiveRef("tracer")
agent_graph_ref = LiveRef("agent_graph")
llm_client_ref = LiveRef("llm_client")
runtime_llm_settings_ref = LiveRef("_runtime_llm_settings")


# Services are created by create_app/lifespan. Proxies preserve legacy module imports.
class _ServiceProxy:
    def __init__(self, name: str):
        object.__setattr__(self, "name", name)

    def _target(self):
        active = _active_services.get()
        if active is not None and self.name in active:
            return active[self.name]
        if self.name == "settings":
            return live("_core_get_settings")()
        return _default_services()[self.name]

    def __getattr__(self, name):
        return getattr(self._target(), name)

    def __setattr__(self, name, value):
        setattr(self._target(), name, value)


_active_services: ContextVar[dict[str, Any] | None] = ContextVar("meridian_services", default=None)
_default_service_cache: dict[str, Any] | None = None
_default_settings = None


def _default_services() -> dict[str, Any]:
    service_cache = live("_default_service_cache")
    if service_cache is None:
        settings = live("_core_get_settings")()
        service_cache = live("_build_services")(settings)
        set_live_value("_default_settings", settings)
        set_live_value("_default_service_cache", service_cache)
    return cast(dict[str, Any], service_cache)

_settings = _ServiceProxy("settings")
vector_store = _ServiceProxy("vector_store")
graph_store = _ServiceProxy("graph_store")
ingestion_pipeline = _ServiceProxy("ingestion_pipeline")
tracer = _ServiceProxy("tracer")
retriever = _ServiceProxy("retriever")
input_guardrails = _ServiceProxy("input_guardrails")
output_guardrails = _ServiceProxy("output_guardrails")
llm_client = _ServiceProxy("llm_client")
agent_graph = _ServiceProxy("agent_graph")


async def init_db(*args, **kwargs):
    from packages.core.db import init_db as initialize_database

    return await initialize_database(*args, **kwargs)


def _index_gate(request: Request) -> JSONResponse | None:
    """Refuse query/retrieve while this app's index cannot be trusted."""
    report = getattr(request.app.state, "index_consistency", None)
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


# Persistent runtime LLM settings
def _get_settings_file() -> Path:
    if os.environ.get("APP_ENV") == "testing":
        return Path("/tmp/meridian_test_settings.json")
    return Path(__file__).parents[2] / ".meridian_settings.json"


SETTINGS_FILE = _get_settings_file()
_SETTINGS_FILE_GETTER = _get_settings_file


def _current_settings_file() -> Path:
    if _get_settings_file is not _SETTINGS_FILE_GETTER:
        return cast(Path, _get_settings_file())
    return cast(Path, live("_get_settings_file")())


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
    settings_file = _current_settings_file()
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
    settings.update({k: v for k, v in saved.items() if not k.endswith(SECRET_SUFFIX) and k != "api_key"})
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
        return validate_provider_url(
            provider,
            url,
            allow_private=_settings.allow_private_provider_urls,
        )
    except ProviderURLNotAllowed:
        raise ValueError("Provider URL is not allowed.") from None


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
        response_headers = {
            key: value
            for key, value in response.headers.items()
            if key.lower() not in {"content-encoding", "content-length", "transfer-encoding"}
        }
        return httpx.Response(
            status_code=response.status_code,
            headers=response_headers,
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
    settings_file = _current_settings_file()
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
        {k: v for k, v in existing.items() if not k.endswith(SECRET_SUFFIX) and k != "api_key"},
        {k: v for k, v in settings.items() if not k.endswith(SECRET_SUFFIX) and k != "api_key"},
    )
    try:
        if secrets:
            save_secrets(secrets_file, secrets)
        with open(settings_file, "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=2)
        os.chmod(settings_file, 0o600)
    except (OSError, ValueError, TypeError):
        logger.warning("Could not save settings.")

class _RuntimeSettings(MutableMapping[str, Any]):
    """Load persisted LLM settings on first use and scope them to the active app."""

    def _target(self) -> dict[str, Any]:
        active = _active_services.get()
        if active is not None and "runtime_llm_settings" in active:
            return cast(dict[str, Any], active["runtime_llm_settings"])
        persisted = live("_default_runtime_settings")
        if persisted is None:
            persisted = _load_persisted_settings()
            set_live_value("_default_runtime_settings", persisted)
        return cast(dict[str, Any], persisted)

    def __getitem__(self, key: str) -> Any:
        return self._target()[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self._target()[key] = value

    def __delitem__(self, key: str) -> None:
        del self._target()[key]

    def __iter__(self):
        return iter(self._target())

    def __len__(self) -> int:
        return len(self._target())


_default_runtime_settings: dict[str, Any] | None = None
_runtime_llm_settings = _RuntimeSettings()

# Session-only cache for tested API keys (not persisted to disk)
_tested_api_keys: dict[str, str] = {}
_tested_api_keys_lock = __import__("asyncio").Lock()

_settings_lock = asyncio.Lock()


def _resolve_active_llm_config_with_secrets() -> dict[str, Any]:
    """Resolves active provider credentials, endpoints, and exact model dynamically.

    Internal only: returns secrets (``api_key``) for the LLM data plane
    (agent graph, connectivity test). Never expose via API responses.
    """
    settings = dict(_runtime_llm_settings)
    env_settings = _settings
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
    api_key = getattr(_settings, f"{provider}_api_key") or settings.get(f"{provider}_api_key")
    base_url = getattr(_settings, f"{provider}_base_url") or settings.get(f"{provider}_base_url") or PROVIDERS[provider]["base_url_default"]
    if provider == "custom":
        base_url = _settings.custom_base_url or settings.get("custom_base_url") or base_url

    return {
        "provider": provider,
        "model": model,
        "api_key": api_key,
        "base_url": base_url,
    }


def get_active_llm_config() -> dict[str, str]:
    """Thin no-secrets reader over the single settings owner."""
    cfg = _resolve_active_llm_config_with_secrets()
    return {
        "provider": cfg.get("provider", "openai"),
        "model": cfg.get("model", ""),
        "base_url": cfg.get("base_url", ""),
    }
