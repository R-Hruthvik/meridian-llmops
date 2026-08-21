"""API key authentication and token bucket rate limiting."""

import asyncio
import os
import time
from collections import defaultdict

from fastapi import Header, HTTPException, status

from packages.core.config import get_settings

# Token bucket state: tenant_id -> (tokens_remaining, last_refill_timestamp)
_rate_limits: dict[str, tuple[float, float]] = defaultdict(lambda: (60.0, time.time()))

# Lock to make token-bucket read-modify-write atomic
_rate_lock = asyncio.Lock()

# TTL for rate-limit entries: evict entries idle longer than this
_RATE_LIMIT_TTL = 300.0  # 5 minutes


async def verify_api_key(
    x_api_key: str = Header(None, alias="X-API-Key"),
    x_tenant_id: str = Header("default", alias="X-Tenant-Id"),
) -> str:
    """Validates X-API-Key and enforces per-tenant rate limiting."""
    settings = get_settings()
    # Require real secret from env; allow MERIDIAN_API_KEY fallback only in dev/testing.
    # Fail-fast in prod: if no secret configured, every request will 401 (operator must set API_KEY_SECRET).
    expected_secret = settings.api_key_secret or (
        os.environ.get("MERIDIAN_API_KEY", "") if settings.app_env in ("development", "testing") else ""
    )

    if not x_api_key or x_api_key != expected_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key header 'X-API-Key'",
        )

    # Token bucket rate limiting (per tenant)
    now = time.time()
    capacity = float(settings.rate_limit_per_minute)
    refill_rate = capacity / 60.0  # tokens per second

    async with _rate_lock:
        # Evict stale entries to prevent unbounded memory growth
        stale_keys = [k for k, (_, ts) in _rate_limits.items() if now - ts > _RATE_LIMIT_TTL]
        for k in stale_keys:
            del _rate_limits[k]

        tokens, last_time = _rate_limits[x_tenant_id]
        elapsed = now - last_time
        tokens = min(capacity, tokens + elapsed * refill_rate)

        if tokens < 1.0:
            _rate_limits[x_tenant_id] = (tokens, now)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded for tenant '{x_tenant_id}'. Max {settings.rate_limit_per_minute} req/min.",
            )

        _rate_limits[x_tenant_id] = (tokens - 1.0, now)
    return x_tenant_id
