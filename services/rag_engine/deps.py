"""Shared FastAPI dependencies for authenticated routes and app services."""

from typing import Any

from fastapi import Request

from services.gateway.auth import require_admin, require_user


def get_settings(request: Request) -> Any:
    """Return settings owned by the current application instance."""
    return request.app.state.settings


def get_services(request: Request) -> dict[str, Any]:
    """Return services owned by the current application instance."""
    return {
        name: getattr(request.app.state, name)
        for name in (
            "vector_store",
            "graph_store",
            "ingestion_pipeline",
            "tracer",
            "retriever",
            "llm_client",
            "input_guardrails",
            "output_guardrails",
            "agent_graph",
        )
        if hasattr(request.app.state, name)
    }


async def get_db():
    """Import database infrastructure only when a database-backed route runs."""
    from packages.core.db import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


__all__ = ["get_db", "get_services", "get_settings", "require_admin", "require_user"]
