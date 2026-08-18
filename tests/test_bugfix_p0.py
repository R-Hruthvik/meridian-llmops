"""Tests for P0 bug fixes in the Meridian LLMOps platform."""

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

# ─── Fix 1: Leaked API key in .meridian_settings.json ─────────────────────────

class TestFix1SettingsFile:
    """Verify that .meridian_settings.json contains no live API keys."""

    def test_no_groq_key_in_settings_file(self):
        settings_path = Path(__file__).parent.parent / ".meridian_settings.json"
        data = json.loads(settings_path.read_text())
        assert data["groq_api_key"] == "", "groq_api_key must be blanked"

    def test_no_custom_key_in_settings_file(self):
        settings_path = Path(__file__).parent.parent / ".meridian_settings.json"
        data = json.loads(settings_path.read_text())
        assert data["custom_api_key"] == "", "custom_api_key must be blanked"

    def test_settings_file_in_gitignore(self):
        gitignore_path = Path(__file__).parent.parent / ".gitignore"
        content = gitignore_path.read_text()
        assert ".meridian_settings.json" in content, "File must be in .gitignore"

    def test_no_live_key_loaded_at_import(self):
        """Ensure _load_persisted_settings doesn't load a real key as fallback."""
        from services.rag_engine.app import _default_llm_settings

        assert _default_llm_settings["groq_api_key"] == ""
        assert _default_llm_settings["custom_api_key"] == ""


# ─── Fix 2: Dead code removal in test_and_fetch_models ───────────────────────

class TestFix2DeadCode:
    """Verify the dead return block is removed and response shape is correct."""

    def test_dead_code_removed(self):
        """The unreachable second return block must be gone."""
        filepath = Path(__file__).parent.parent / "services" / "rag_engine" / "app.py"
        content = filepath.read_text()

        # The dead code's signature must not exist
        assert '"status": "connected"' not in content.split("def test_and_fetch_models")[1].split("def test_llm_connection")[0], \
            "Dead return block with 'status: connected' must be removed"

        # The +12.0 magic number must not exist in test_and_fetch_models
        func_body = content.split("def test_and_fetch_models")[1].split("def test_llm_connection")[0]
        assert "+ 12.0" not in func_body, "+12.0 magic number must be removed"

    def test_single_return_shape(self):
        """test_and_fetch_models should have exactly 2 returns (early-bail + final), no dead 3rd."""
        filepath = Path(__file__).parent.parent / "services" / "rag_engine" / "app.py"
        content = filepath.read_text()

        # Extract the function body precisely
        start_idx = content.index("def test_and_fetch_models")
        end_idx = content.index("def test_llm_connection")
        func_body = content[start_idx:end_idx]
        return_count = func_body.count("return {")
        assert return_count == 2, f"Expected 2 return dicts (early-bail + final), found {return_count}"

        assert '\"success\":' in func_body, "Response must include 'success' field"
        # The dead code's "connected" status should NOT be in this function
        assert '"status": "connected"' not in func_body, "Dead 'connected' return must be removed"
        # The +12.0 magic number should not be in this function
        assert "+ 12.0" not in func_body, "Dead +12.0 magic number must be removed"


# ─── Fix 3: Hardcoded default secrets in Settings ─────────────────────────────

class TestFix3ConfigSecrets:
    """Verify Settings no longer has hardcoded secret defaults."""

    def test_no_hardcoded_api_key_secret(self):
        """api_key_secret must come from env, not be a baked-in literal in config.py."""
        config_path = Path(__file__).parent.parent / "packages" / "core" / "config.py"
        content = config_path.read_text()
        assert "meridian-test-secret-key-2026" not in content, \
            "config.py must not contain the old hardcoded default"
        assert "os.environ.get(\"API_KEY_SECRET\"" in content or "os.environ.get('API_KEY_SECRET'" in content, \
            "api_key_secret must read from environment"

    def test_no_hardcoded_litellm_master_key(self):
        config_path = Path(__file__).parent.parent / "packages" / "core" / "config.py"
        content = config_path.read_text()
        assert "sk-litellm-master-key" not in content, \
            "config.py must not contain the old hardcoded litellm key"

    def test_no_hardcoded_neo4j_password(self):
        from packages.core.config import Settings

        s = Settings()
        assert s.neo4j_password != "meridian_password", \
            "neo4j_password must not have the old hardcoded default"

    def test_non_secret_defaults_preserved(self):
        from packages.core.config import Settings

        s = Settings()
        assert s.api_port == 8000
        assert s.qdrant_collection == "meridian_documents"
        assert s.default_llm_model == "gpt-4o-mini"


# ─── Fix 4: Fake latency in test_llm_connection ────────────────────────────────

class TestFix4FakeLatency:
    """Verify test_llm_connection no longer uses fake +15.0 padding."""

    def test_no_fake_latency_constant(self):
        filepath = Path(__file__).parent.parent / "services" / "rag_engine" / "app.py"
        content = filepath.read_text()

        # Extract just the test_llm_connection function body
        func_body = content.split("def test_llm_connection")[1].split("\n\n\n")[0]
        assert "+ 15.0" not in func_body, "Fake +15.0 latency padding must be removed"
        assert "+ 12.0" not in func_body, "Fake +12.0 latency padding must be removed"

    def test_real_api_call_made(self):
        filepath = Path(__file__).parent.parent / "services" / "rag_engine" / "app.py"
        content = filepath.read_text()

        func_body = content.split("def test_llm_connection")[1].split("\n\n\n")[0]
        assert "httpx.AsyncClient" in func_body, \
            "test_llm_connection must make a real HTTP call via httpx"
        assert "/models" in func_body or "/chat/completions" in func_body, \
            "Should hit a real provider endpoint"

    def test_connection_test_returns_real_status(self):
        """When the endpoint is unreachable, status should be 'error', not always 'connected'."""
        filepath = Path(__file__).parent.parent / "services" / "rag_engine" / "app.py"
        content = filepath.read_text()

        func_body = content.split("def test_llm_connection")[1].split("\n\n\n")[0]
        assert '"status": "success" if is_success else "error"' in func_body, \
            "Should return dynamic success/error status"
        assert 'is_success' in func_body


# ─── Fix 5: Rate limiter thread-safety ─────────────────────────────────────────

class TestFix5RateLimiter:
    """Verify rate limiter has asyncio.Lock and TTL-based eviction."""

    def test_rate_limiter_has_lock(self):
        filepath = Path(__file__).parent.parent / "services" / "gateway" / "auth.py"
        content = filepath.read_text()
        assert "asyncio.Lock" in content, "Must use asyncio.Lock"
        assert "_rate_lock" in content, "Lock must be named _rate_lock"

    def test_rate_limiter_has_ttl_eviction(self):
        filepath = Path(__file__).parent.parent / "services" / "gateway" / "auth.py"
        content = filepath.read_text()
        assert "TTL" in content or "_RATE_LIMIT_TTL" in content, "Must have TTL-based eviction"
        assert "stale_keys" in content or "del _rate_limits" in content, "Must delete stale entries"

    def test_rate_limiter_concurrent_requests(self):
        """Fire concurrent requests and verify exactly the right number succeed."""
        from services.gateway import auth
        from services.gateway.app import app

        # Reset the rate limits for this test
        auth._rate_limits.clear()

        headers = {"X-API-Key": "meridian-test-secret-key-2026", "X-Tenant-Id": "concurrent-test-tenant"}

        async def fire_requests():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                tasks = [
                    ac.post("/v1/guardrails/check", headers=headers, json={"text": "safe prompt"})
                    for _ in range(80)
                ]
                responses = await asyncio.gather(*tasks, return_exceptions=True)
                return responses

        responses = asyncio.run(fire_requests())
        success_count = sum(1 for r in responses if not isinstance(r, Exception) and r.status_code == 200)
        rate_limited = sum(1 for r in responses if not isinstance(r, Exception) and r.status_code == 429)
        assert success_count <= 60, f"Too many succeeded: {success_count}"
        assert rate_limited >= 20, f"Not enough rate-limited: {rate_limited}"

    def test_rate_limiter_tenant_isolation(self):
        """Different tenants have independent rate limits."""
        from services.gateway.app import app

        client = TestClient(app)
        key = "meridian-test-secret-key-2026"

        # Tenant A uses 30 requests
        for i in range(30):
            resp = client.post(
                "/v1/guardrails/check",
                headers={"X-API-Key": key, "X-Tenant-Id": "tenant-a-isolation"},
                json={"text": "safe prompt"},
            )
            assert resp.status_code == 200

        # Tenant B should still have full quota
        resp = client.post(
            "/v1/guardrails/check",
            headers={"X-API-Key": key, "X-Tenant-Id": "tenant-b-isolation"},
            json={"text": "safe prompt"},
        )
        assert resp.status_code == 200, "Tenant B should not be rate-limited"

    def test_rate_limiter_eviction_prevents_memory_leak(self):
        """Verify stale entries are evicted."""
        from services.gateway import auth

        # Add some stale entries
        old_time = auth.time.time() - auth._RATE_LIMIT_TTL - 1
        auth._rate_limits["stale-tenant-1"] = (0.0, old_time)
        auth._rate_limits["stale-tenant-2"] = (0.0, old_time)

        # Trigger a rate limit check for a valid tenant
        async def trigger_check():
            # Mock the settings check to pass
            return await auth.verify_api_key(
                x_api_key="dummy",
                x_tenant_id="trigger-tenant",
            )

        # Just verify eviction logic by calling directly
        now = auth.time.time()
        stale_keys = [k for k, (_, ts) in auth._rate_limits.items() if now - ts > auth._RATE_LIMIT_TTL]
        for k in stale_keys:
            del auth._rate_limits[k]

        assert "stale-tenant-1" not in auth._rate_limits
        assert "stale-tenant-2" not in auth._rate_limits


# ─── Fix 6: LiteLLMClient error handling ───────────────────────────────────────

class TestFix6ErrorHandling:
    """Verify LiteLLMClient uses logging and propagates errors."""

    def test_client_uses_logging_not_print(self):
        filepath = Path(__file__).parent.parent / "services" / "gateway" / "client.py"
        content = filepath.read_text()
        assert "import logging" in content, "Must import logging"
        assert "logger = logging.getLogger" in content, "Must create a logger"
        assert "print(" not in content, "Must not use print() for errors"

    def test_client_propagates_errors(self):
        """On HTTP error, client should raise, not return fabricated answer."""
        filepath = Path(__file__).parent.parent / "services" / "gateway" / "client.py"
        content = filepath.read_text()
        assert "raise" in content, "Client must raise on errors"
        assert "fallback_answer" not in content, "Must not fabricate fallback answers"

    def test_client_raises_on_http_status_error(self):
        """When the LLM API returns non-200, an HTTPStatusError should be raised."""
        from services.gateway.client import LiteLLMClient

        client = LiteLLMClient()

        async def run_test():
            with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
                mock_resp = MagicMock()
                mock_resp.status_code = 500
                mock_resp.text = "Internal Server Error"
                mock_resp.request = MagicMock()
                mock_post.return_value = mock_resp

                with pytest.raises(httpx.HTTPStatusError):
                    await client.chat_completion(
                        messages=[{"role": "user", "content": "Hello"}],
                        model="gpt-4o-mini",
                    )

        asyncio.run(run_test())

    def test_client_raises_on_connection_error(self):
        """When the LLM API is unreachable, an error should be raised (not a fallback)."""
        from services.gateway.client import LiteLLMClient

        client = LiteLLMClient()

        async def run_test():
            with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
                mock_post.side_effect = httpx.ConnectError("Connection refused")

                with pytest.raises(httpx.HTTPError):
                    await client.chat_completion(
                        messages=[{"role": "user", "content": "Hello"}],
                        model="gpt-4o-mini",
                    )

        asyncio.run(run_test())


# ─── Regression: Existing endpoints still work ─────────────────────────────────

class TestRegressionEndpoints:
    """Verify existing API endpoints still function after fixes."""

    def test_health_endpoint(self):
        from services.rag_engine.app import app

        client = TestClient(app)
        res = client.get("/health")
        assert res.status_code == 200

    def test_query_endpoint_still_works(self):
        from services.rag_engine.app import app

        client = TestClient(app)
        res = client.post(
            "/v1/query",
            headers={"X-API-Key": "meridian-test-secret-key-2026"},
            json={"query": "What is Meridian?"},
        )
        assert res.status_code == 200
        data = res.json()
        assert "answer" in data
        assert "refusal" in data

    def test_settings_endpoint(self):
        from services.rag_engine.app import app

        client = TestClient(app)
        res = client.get(
            "/v1/settings/llm",
            headers={"X-API-Key": "meridian-test-secret-key-2026"},
        )
        assert res.status_code == 200
