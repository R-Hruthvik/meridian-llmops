"""API-key authentication and per-key token-bucket rate limiting."""

import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
from dataclasses import dataclass

from fastapi import Header, HTTPException, status

from packages.core.config import get_settings

logger = logging.getLogger(__name__)

# Rate-limit identifiers are SHA-256 digests so the in-memory state never stores keys.
_rate_limits: dict[str, tuple[float, float]] = {}
_rate_lock = asyncio.Lock()
_RATE_LIMIT_TTL = 300.0
_DEVELOPMENT_DEFAULT_KEYS = frozenset({
    "dev-key-change-me",
    "meridian-test-secret-key-2026",
    "sk-litellm-master-key",
    "changeme",
})


@dataclass(frozen=True)
class AuthIdentity:
    tenant_id: str
    role: str
    key_id: str


def _configured_keys() -> dict[str, AuthIdentity]:
    settings = get_settings()
    raw_keys = os.environ.get("API_KEYS") or settings.api_keys.get_secret_value()
    configured: dict[str, AuthIdentity] = {}
    if raw_keys:
        try:
            entries = json.loads(raw_keys)
        except json.JSONDecodeError as error:
            raise RuntimeError("API_KEYS must be a JSON object mapping keys to tenant and role") from error
        if not isinstance(entries, dict):
            raise RuntimeError("API_KEYS must be a JSON object mapping keys to tenant and role")
        for api_key, attributes in entries.items():
            if not isinstance(api_key, str) or not api_key or not isinstance(attributes, dict):
                raise RuntimeError("Each API_KEYS entry must map a non-empty key to an object")
            tenant_id, role = attributes.get("tenant"), attributes.get("role")
            if not isinstance(tenant_id, str) or not tenant_id or role not in {"user", "admin"}:
                raise RuntimeError("Each API_KEYS entry requires a tenant and a role of 'user' or 'admin'")
            configured[api_key] = AuthIdentity(tenant_id, role, hashlib.sha256(api_key.encode()).hexdigest())

    # Compatibility for existing local launch and test environments. Production uses API_KEYS.
    if not configured and settings.app_env in {"development", "testing"}:
        legacy_key = os.environ.get("API_KEY_SECRET", "")
        if not legacy_key:
            legacy_key = get_settings().api_key_secret
        if legacy_key:
            configured[legacy_key] = AuthIdentity(
                "default", "user", hashlib.sha256(legacy_key.encode()).hexdigest()
            )

    admin_key = os.environ.get("ADMIN_API_KEY") or settings.admin_api_key.get_secret_value()
    if admin_key:
        existing = next((identity for key, identity in configured.items() if hmac.compare_digest(key, admin_key)), None)
        configured[admin_key] = AuthIdentity(
            existing.tenant_id if existing else "admin",
            "admin",
            hashlib.sha256(admin_key.encode()).hexdigest(),
        )
    return configured


def validate_auth_configuration() -> None:
    """Fail startup for malformed mappings or known development credentials in production."""
    keys = _configured_keys()
    settings = get_settings()
    if settings.app_env != "production":
        return
    raw_keys = os.environ.get("API_KEYS") or settings.api_keys.get_secret_value()
    configured_raw = list(json.loads(raw_keys or "{}").keys())
    admin_key = os.environ.get("ADMIN_API_KEY") or settings.admin_api_key.get_secret_value()
    if not configured_raw and not admin_key:
        raise RuntimeError("production requires API_KEYS and ADMIN_API_KEY")
    if not admin_key and not any(identity.role == "admin" for identity in keys.values()):
        raise RuntimeError("production requires ADMIN_API_KEY or an admin role in API_KEYS")
    if any(key.strip().lower() in _DEVELOPMENT_DEFAULT_KEYS for key in [*configured_raw, admin_key] if key):
        raise RuntimeError("production API keys must not use a known development default")


def _authenticate(api_key: str | None, tenant_header: str | None) -> AuthIdentity:
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key header 'X-API-Key'",
        )
    identity = None
    for candidate, candidate_identity in _configured_keys().items():
        if hmac.compare_digest(api_key, candidate):
            identity = candidate_identity
    if identity is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key header 'X-API-Key'",
        )
    if tenant_header is not None and tenant_header != identity.tenant_id:
        logger.warning("Ignoring mismatched X-Tenant-Id for authenticated tenant %s", identity.tenant_id)
    return identity


async def _apply_rate_limit(identity: AuthIdentity) -> None:
    settings = get_settings()
    now = time.time()
    capacity = float(settings.rate_limit_per_minute)
    refill_rate = capacity / 60.0
    async with _rate_lock:
        stale_keys = [key for key, (_, ts) in _rate_limits.items() if now - ts > _RATE_LIMIT_TTL]
        for key in stale_keys:
            del _rate_limits[key]
        tokens, last_time = _rate_limits.get(identity.key_id, (capacity, now))
        tokens = min(capacity, tokens + (now - last_time) * refill_rate)
        if tokens < 1.0:
            _rate_limits[identity.key_id] = (tokens, now)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded. Max {settings.rate_limit_per_minute} req/min.",
            )
        _rate_limits[identity.key_id] = (tokens - 1.0, now)


async def require_user(
    x_api_key: str | None = Header(None, alias="X-API-Key"),
    x_tenant_id: str | None = Header(None, alias="X-Tenant-Id"),
) -> str:
    """Authenticate any configured API key and return its server-assigned tenant."""
    identity = _authenticate(x_api_key, x_tenant_id)
    await _apply_rate_limit(identity)
    return identity.tenant_id


async def require_admin(
    x_api_key: str | None = Header(None, alias="X-API-Key"),
    x_tenant_id: str | None = Header(None, alias="X-Tenant-Id"),
) -> str:
    """Authenticate an admin key and return its server-assigned tenant."""
    identity = _authenticate(x_api_key, x_tenant_id)
    if identity.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    await _apply_rate_limit(identity)
    return identity.tenant_id


# Existing gateway integrations import this name; it now has the secure user semantics.
verify_api_key = require_user
