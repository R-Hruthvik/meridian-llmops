"""Phase 5 API-key identity and route protection regressions."""

import asyncio
import json

import pytest
from fastapi import HTTPException

from services.gateway import auth


@pytest.fixture
def mapped_keys(monkeypatch):
    from packages.core.settings import get_settings

    monkeypatch.setenv("APP_ENV", "testing")
    monkeypatch.setenv(
        "API_KEYS",
        json.dumps({
            "user-key-for-tests": {"tenant": "tenant-a", "role": "user"},
            "admin-key-for-tests": {"tenant": "operations", "role": "admin"},
        }),
    )
    monkeypatch.setenv("ADMIN_API_KEY", "admin-key-for-tests")
    get_settings.cache_clear()
    auth._rate_limits.clear()
    yield
    get_settings.cache_clear()


def test_missing_and_wrong_keys_are_rejected(mapped_keys):
    for api_key in (None, "wrong-key"):
        with pytest.raises(HTTPException) as error:
            auth._authenticate(api_key, None)
        assert error.value.status_code == 401


def test_tenant_is_derived_from_key_and_mismatched_header_is_logged(mapped_keys, caplog):
    tenant = asyncio.run(auth.require_user("user-key-for-tests", "spoofed-tenant"))
    assert tenant == "tenant-a"
    assert "Ignoring mismatched X-Tenant-Id" in caplog.text


def test_user_key_cannot_access_admin_dependency(mapped_keys):
    with pytest.raises(HTTPException) as error:
        asyncio.run(auth.require_admin("user-key-for-tests", None))
    assert error.value.status_code == 403


def test_admin_api_key_is_accepted(mapped_keys):
    assert asyncio.run(auth.require_admin("admin-key-for-tests", "spoofed")) == "operations"


def test_rate_limit_starts_with_configured_capacity(mapped_keys, monkeypatch):
    from collections import defaultdict

    from packages.core.settings import get_settings

    class RecordingBuckets(defaultdict):
        initial_bucket = None

        def __init__(self):
            super().__init__(lambda: (60.0, 0.0))

        def __missing__(self, key):
            self.initial_bucket = self.default_factory()
            self[key] = self.initial_bucket
            return self.initial_bucket

        def get(self, key, default=None):
            if key not in self:
                self.initial_bucket = default
            return super().get(key, default)

    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "3")
    get_settings.cache_clear()
    buckets = RecordingBuckets()
    monkeypatch.setattr(auth, "_rate_limits", buckets)

    async def send_four_requests():
        statuses = []
        for _ in range(4):
            try:
                await auth.require_user("user-key-for-tests", None)
                statuses.append(200)
            except HTTPException as error:
                statuses.append(error.status_code)
        return statuses

    try:
        assert asyncio.run(send_four_requests()) == [200, 200, 200, 429]
        assert buckets.initial_bucket[0] == 3
    finally:
        get_settings.cache_clear()


def test_http_auth_returns_401_and_403(mapped_keys):
    from fastapi.testclient import TestClient

    from services.rag_engine.app import app

    with TestClient(app) as client:
        assert client.get("/v1/documents").status_code == 401
        assert client.get("/v1/documents", headers={"X-API-Key": "wrong-key"}).status_code == 401
        user_headers = {"X-API-Key": "user-key-for-tests"}
        assert client.get("/v1/settings/llm", headers=user_headers).status_code == 403
        assert client.get("/v1/documents", headers=user_headers | {"X-Tenant-Id": "spoof"}).status_code == 200


def test_production_rejects_known_development_keys(monkeypatch):
    from fastapi.testclient import TestClient

    from packages.core.settings import get_settings
    from services.rag_engine.app import app

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv(
        "API_KEYS",
        json.dumps({"dev-key-change-me": {"tenant": "tenant-a", "role": "user"}}),
    )
    monkeypatch.setenv("ADMIN_API_KEY", "production-admin-key")
    get_settings.cache_clear()
    try:
        with pytest.raises(RuntimeError, match="known development default"), TestClient(app):
            pass
    finally:
        get_settings.cache_clear()


def test_production_accepts_api_keys_without_legacy_single_key():
    from pydantic import SecretStr

    from packages.core.settings import Settings, validate_production

    settings = Settings(
        _env_file=None,
        app_env="production",
        api_key_secret="",
        api_keys=SecretStr(json.dumps({"user-key": {"tenant": "a", "role": "user"}})),
        admin_api_key=SecretStr("admin-key"),
        litellm_master_key="real-litellm-key",
    )
    validate_production(settings)



def _iter_api_routes(routes):
    """Walk nested routers, including FastAPI's lazy _IncludedRouter wrappers."""
    for route in routes:
        if hasattr(route, "dependant"):
            yield route
            continue
        original_router = getattr(route, "original_router", None)
        if original_router is not None:
            yield from _iter_api_routes(original_router.routes)

def test_every_rag_and_gateway_route_is_authenticated_except_health():
    from services.gateway.app import app as gateway_app
    from services.rag_engine.app import app as rag_app

    apps_and_public_health = (
        (rag_app, {"/health/live", "/health/ready"}),
        (gateway_app, {"/health"}),
    )
    for app, public_health in apps_and_public_health:
        found_public_health = set()
        for route in _iter_api_routes(app.routes):
            path = getattr(route, "path", "")
            if path in public_health:
                dependency_names = {dependency.call for dependency in route.dependant.dependencies}
                assert not dependency_names & {auth.require_user, auth.require_admin}
                found_public_health.add(path)
                continue
            dependency_names = {dependency.call for dependency in route.dependant.dependencies}
            assert dependency_names & {auth.require_user, auth.require_admin}, f"Unauthenticated route: {path}"
        assert found_public_health == public_health


def test_sensitive_rag_routes_require_admin():
    from services.gateway.auth import require_admin
    from services.rag_engine.app import app

    admin_paths = {
        "/v1/metrics",
        "/v1/reindex",
        "/v1/settings/llm",
        "/v1/settings/providers",
        "/v1/settings/llm/test-and-fetch-models",
        "/v1/settings/test",
        "/v1/settings/llm/test",
        "/v1/review/items",
        "/v1/review/items/{item_id}/action",
    }
    for route in _iter_api_routes(app.routes):
        if getattr(route, "path", "") in admin_paths:
            assert require_admin in {dependency.call for dependency in route.dependant.dependencies}
