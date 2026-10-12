from fastapi.testclient import TestClient

from packages.core.settings import Settings


def test_generic_dotenv_values_override_saved_runtime_provider(monkeypatch, tmp_path):
    for name in ("API_KEY", "BASE_URL", "MODEL", "PROVIDER"):
        monkeypatch.delenv(name, raising=False)
    env_file = tmp_path / "isolated.env"
    env_file.write_text("API_KEY=isolated-test-key\nBASE_URL=https://isolated.example/v1\nMODEL=isolated-model\n")
    settings = Settings(_env_file=env_file)
    from services.rag_engine import app as rag_app
    monkeypatch.setattr(rag_app, "_core_get_settings", lambda: settings)

    before = dict(rag_app._runtime_llm_settings)
    try:
        rag_app._runtime_llm_settings.update({"active_provider": "openai", "openai_api_key": "saved-ui-key", "default_model": "saved-ui-model", "openai_base_url": "https://saved.example/v1"})
        config = rag_app._resolve_active_llm_config_with_secrets()
        listing = TestClient(rag_app.app).get("/v1/settings/providers", headers={"X-API-Key": "meridian-test-secret-key-2026"}).json()
    finally:
        rag_app._runtime_llm_settings.clear()
        rag_app._runtime_llm_settings.update(before)

    assert config == {"provider": "custom", "model": "isolated-model", "api_key": "isolated-test-key", "base_url": "https://isolated.example/v1"}
    assert listing["active_provider"] == "custom"
    custom = next(provider for provider in listing["providers"] if provider["id"] == "custom")
    assert custom["base_url"] == "https://isolated.example/v1"
    assert custom["current_model"] == "isolated-model"
    assert "isolated-test-key" not in str(listing)


def test_generic_dotenv_provider_selects_configured_provider(monkeypatch, tmp_path):
    for name in ("API_KEY", "BASE_URL", "MODEL", "PROVIDER"):
        monkeypatch.delenv(name, raising=False)
    env_file = tmp_path / "isolated.env"
    env_file.write_text("PROVIDER=anthropic\nAPI_KEY=isolated-test-key\nBASE_URL=https://anthropic.example\nMODEL=claude-test\n")
    settings = Settings(_env_file=env_file)
    from services.rag_engine import app as rag_app
    monkeypatch.setattr(rag_app, "_core_get_settings", lambda: settings)

    before = dict(rag_app._runtime_llm_settings)
    try:
        config = rag_app._resolve_active_llm_config_with_secrets()
    finally:
        rag_app._runtime_llm_settings.clear()
        rag_app._runtime_llm_settings.update(before)

    assert config == {"provider": "anthropic", "model": "claude-test", "api_key": "isolated-test-key", "base_url": "https://anthropic.example"}


def test_settings_test_runs_one_token_generation(monkeypatch):
    from services.rag_engine import app as rag_app

    settings = Settings(_env_file=None, provider="custom", api_key="test-key", base_url="https://llm.example/v1", model="m")
    monkeypatch.setattr(rag_app, "_core_get_settings", lambda: settings)
    captured = {}

    class FakeClient:
        async def chat_completion(self, **kwargs):
            captured.update(kwargs)
            return {"choices": [{"message": {"content": "OK"}}]}

    monkeypatch.setattr(rag_app, "llm_client", FakeClient())
    response = TestClient(rag_app.app).post("/v1/settings/llm/test", headers={"X-API-Key": "meridian-test-secret-key-2026"})

    assert response.status_code == 200
    assert response.json()["status"] == "success"
    assert captured["max_tokens"] == 1
    assert captured["provider"] == "custom"
    assert captured["api_key"] == "test-key"


def test_llm_prefixed_dotenv_aliases_and_generic_priority(monkeypatch, tmp_path):
    for name in ("API_KEY", "BASE_URL", "MODEL", "PROVIDER", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_PROVIDER"):
        monkeypatch.delenv(name, raising=False)
    env_file = tmp_path / "aliases.env"
    env_file.write_text("LLM_PROVIDER=anthropic\nLLM_API_KEY=llm-key\nLLM_BASE_URL=https://llm.example\nLLM_MODEL=llm-model\n")
    llm_values = Settings(_env_file=env_file)
    assert (llm_values.provider, llm_values.api_key, llm_values.base_url, llm_values.model) == (
        "anthropic", "llm-key", "https://llm.example", "llm-model"
    )

    monkeypatch.setenv("PROVIDER", "custom")
    monkeypatch.setenv("API_KEY", "generic-key")
    monkeypatch.setenv("BASE_URL", "https://generic.example/v1")
    monkeypatch.setenv("MODEL", "generic-model")
    generic_values = Settings(_env_file=env_file)
    assert (generic_values.provider, generic_values.api_key, generic_values.base_url, generic_values.model) == (
        "custom", "generic-key", "https://generic.example/v1", "generic-model"
    )


def test_generic_settings_fields_accept_constructor_names():
    settings = Settings(_env_file=None, provider="custom", api_key="key", base_url="https://example/v1", model="m")
    assert (settings.provider, settings.api_key, settings.base_url, settings.model) == (
        "custom", "key", "https://example/v1", "m"
    )


def test_min_dense_score_defaults_to_calibrated_round_value():
    assert Settings(_env_file=None).min_dense_score == 0.70


def test_canonical_settings_test_route_runs_generation(monkeypatch):
    from services.rag_engine import app as rag_app

    settings = Settings(_env_file=None, provider="custom", api_key="test-key", base_url="https://llm.example/v1", model="m")
    monkeypatch.setattr(rag_app, "_core_get_settings", lambda: settings)

    class FakeClient:
        async def chat_completion(self, **kwargs):
            return {"choices": [{"message": {"content": "OK"}}]}

    monkeypatch.setattr(rag_app, "llm_client", FakeClient())
    response = TestClient(rag_app.app).post("/v1/settings/test", headers={"X-API-Key": "meridian-test-secret-key-2026"})
    assert response.status_code == 200
    assert response.json()["status"] == "success"
