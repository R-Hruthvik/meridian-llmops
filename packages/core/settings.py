"""Single owner module for application settings.

All configuration flows from here. Other modules import
:func:`get_settings` (or ``Settings``) from this module; ``packages.core.config``
remains only as a re-export shim until migration completes.
"""

import json
import os
from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Global system configuration loaded from environment or .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
        env_nested_delimiter="__",
        secrets_dir="/run/secrets",
    )

    # API & Service
    app_env: str = "production"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_key_secret: str = Field(default_factory=lambda: os.environ.get("API_KEY_SECRET", ""))
    api_keys: SecretStr = Field(default=SecretStr(""), validation_alias="API_KEYS")
    admin_api_key: SecretStr = Field(default=SecretStr(""), validation_alias="ADMIN_API_KEY")
    rate_limit_per_minute: int = Field(60, ge=1)
    max_upload_mb: int = Field(default=25, gt=0)
    ocr_api_key: SecretStr = Field(default=SecretStr(""), validation_alias="OCR_API_KEY")
    allow_private_provider_urls: bool = False

    # LiteLLM AI Gateway
    litellm_base_url: str = "http://localhost:4000"
    litellm_master_key: str = Field(default_factory=lambda: os.environ.get("LITELLM_MASTER_KEY", ""))
    default_llm_model: str = "gpt-4o-mini"
    # Generic provider environment settings intentionally override saved UI settings.
    provider: str | None = Field(default=None, validation_alias=AliasChoices("PROVIDER", "LLM_PROVIDER"))
    api_key: str | None = Field(default=None, validation_alias=AliasChoices("API_KEY", "LLM_API_KEY"))
    base_url: str | None = Field(default=None, validation_alias=AliasChoices("BASE_URL", "LLM_BASE_URL"))
    model: str | None = Field(default=None, validation_alias=AliasChoices("MODEL", "LLM_MODEL"))
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    groq_api_key: str | None = None
    openrouter_api_key: str | None = None
    deepseek_api_key: str | None = None
    ollama_api_key: str | None = None
    custom_api_key: str | None = None
    openai_base_url: str | None = None
    anthropic_base_url: str | None = None
    groq_base_url: str | None = None
    openrouter_base_url: str | None = None
    deepseek_base_url: str | None = None
    ollama_base_url: str | None = None
    custom_base_url: str | None = None
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    fastembed_cache_path: str = "storage/fastembed"
    reranker: Literal["none", "lexical", "cross_encoder"] = "none"
    reranker_model: str = Field(
        default="Xenova/ms-marco-MiniLM-L-6-v2",
        validation_alias=AliasChoices("RERANK_MODEL", "RERANKER_MODEL"),
    )
    verify_mode: Literal["citations", "llm", "off"] = "citations"

    # Qdrant Vector Database
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_collection: str = "meridian_documents"
    qdrant_vector_dim: int = 384
    vector_backend: Literal['qdrant', 'qdrant_local'] = 'qdrant'
    qdrant_local_path: str = 'storage/qdrant'

    # Neo4j Knowledge Graph
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = Field(default_factory=lambda: os.environ.get("NEO4J_PASSWORD", ""))
    # Graph storage/traversal and generation augmentation are independently gated.
    graph_enabled: bool = False
    # Experimental graph context stays off until a multi-hop A/B eval shows a gain.
    graph_context_enabled: bool = False

    # Langfuse Observability
    langfuse_host: str = "http://localhost:3000"
    langfuse_public_key: str | None = Field(default_factory=lambda: os.environ.get("LANGFUSE_PUBLIC_KEY"))
    langfuse_secret_key: str | None = Field(default_factory=lambda: os.environ.get("LANGFUSE_SECRET_KEY"))
    enable_langfuse: bool = False

    # Guardrails
    enable_input_guardrails: bool = True
    enable_output_guardrails: bool = True
    allow_client_disable_guardrails: bool = False

    # Relational Database & Human-in-the-Loop Review Queue
    database_url: str = Field(default_factory=lambda: os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./verified_rag.db"))
    confidence_threshold: float = 0.85
    min_dense_score: float = Field(default=0.70, ge=0.0, le=1.0)
    retrieval_default_top_k: int = Field(default=5, ge=1, le=20)
    max_cycles: int = Field(default=2, ge=1, le=4)
    debug_log_prompts: bool = False


_FORBIDDEN_PRODUCTION_SECRETS = frozenset({
    "meridian-test-secret-key-2026",
    "sk-litellm-master-key",
    "changeme",
})


def _is_forbidden_production_secret(value: str | None) -> bool:
    """Fail-closed check: empty, blank, or known test-default secrets."""
    if value is None:
        return True
    stripped = value.strip()
    if not stripped:
        return True
    if stripped in _FORBIDDEN_PRODUCTION_SECRETS:
        return True
    return stripped.lower() == "changeme"


def validate_production(s: Settings) -> None:
    if s.app_env != "production":
        return
    raw_api_keys = s.api_keys.get_secret_value().strip()
    admin_api_key = s.admin_api_key.get_secret_value().strip()
    has_api_key_config = bool(raw_api_keys or admin_api_key)
    if _is_forbidden_production_secret(s.api_key_secret) and not has_api_key_config:
        raise RuntimeError("missing required secret: API_KEY_SECRET")
    if _is_forbidden_production_secret(s.litellm_master_key):
        raise RuntimeError("missing required secret: LITELLM_MASTER_KEY")
    if admin_api_key and _is_forbidden_production_secret(admin_api_key):
        raise RuntimeError("missing required secret: ADMIN_API_KEY")
    if raw_api_keys:
        try:
            parsed = json.loads(raw_api_keys)
        except (TypeError, ValueError) as error:
            raise RuntimeError("missing required secret: API_KEYS") from error
        if (not isinstance(parsed, dict) or not parsed) and not admin_api_key:
            raise RuntimeError("missing required secret: API_KEYS")
        for key in (list(parsed.keys()) if isinstance(parsed, dict) else []):
            if _is_forbidden_production_secret(key):
                raise RuntimeError("missing required secret: API_KEYS")
    if not has_api_key_config and _is_forbidden_production_secret(s.api_key_secret):
        raise RuntimeError("missing required secret: API_KEYS")


@lru_cache
def get_settings() -> Settings:
    """Returns singleton settings instance."""
    return Settings()
