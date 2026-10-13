"""Shared request dependencies for authenticated RAG-engine routes."""

from services.gateway.auth import require_admin, require_user

__all__ = ["require_admin", "require_user"]
