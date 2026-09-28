"""Application configuration and environment settings."""

import os
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Global system configuration loaded from environment or .env file."""
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # API & Service
    app_env: str = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_key_secret: str = Field(default_factory=lambda: os.environ.get("API_KEY_SECRET", ""))
    rate_limit_per_minute: int = 60

    # LiteLLM AI Gateway
    litellm_base_url: str = "http://localhost:4000"
    litellm_master_key: str = Field(default_factory=lambda: os.environ.get("LITELLM_MASTER_KEY", ""))
    default_llm_model: str = "gpt-4o-mini"
    critic_llm_model: str = "gpt-4o-mini"
    embedding_model: str = "BAAI/bge-m3"
    reranker_model: str = "BAAI/bge-reranker-large"

    # Qdrant Vector Database
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_collection: str = "meridian_documents"
    qdrant_vector_dim: int = 1024

    # Neo4j Knowledge Graph
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = Field(default_factory=lambda: os.environ.get("NEO4J_PASSWORD", ""))

    # Langfuse Observability
    langfuse_host: str = "http://localhost:3000"
    langfuse_public_key: str | None = Field(default_factory=lambda: os.environ.get("LANGFUSE_PUBLIC_KEY"))
    langfuse_secret_key: str | None = Field(default_factory=lambda: os.environ.get("LANGFUSE_SECRET_KEY"))
    enable_langfuse: bool = False

    # Guardrails
    enable_input_guardrails: bool = True
    enable_output_guardrails: bool = True

    # Relational Database & Human-in-the-Loop Review Queue
    database_url: str = Field(default_factory=lambda: os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./verified_rag.db"))
    confidence_threshold: float = 0.85


def validate_production(s: Settings) -> None:
    if s.app_env == "production" and not s.api_key_secret:
        raise RuntimeError("missing required secret: API_KEY_SECRET")
    if s.app_env == "production" and not s.litellm_master_key:
        raise RuntimeError("missing required secret: LITELLM_MASTER_KEY")


@lru_cache
def get_settings() -> Settings:
    """Returns singleton settings instance."""
    return Settings()
