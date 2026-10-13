"""Regression tests for non-destructive provider-config persistence (wayfinder T3).

Locks the merge-on-save contract: blank or masked submissions must never clobber
saved provider credentials/endpoints, in memory or on disk.
"""

import json

import pytest
from fastapi.testclient import TestClient

HDR = {"X-API-Key": "meridian-test-admin-key-2026"}


@pytest.fixture()
def settings_path(tmp_path, monkeypatch):
    """Redirect persistence to an isolated file pre-seeded with saved state."""
    p = tmp_path / "settings.json"
    p.write_text(
        json.dumps(
            {
                "groq_api_key": "sk-SAVED-GROQ",
                "openai_org_id": "org-SAVED",
                "default_model": "gpt-4o-mini",
                "custom_base_url": "http://localhost:9999/v1",
            }
        )
    )
    monkeypatch.setenv("APP_ENV", "testing")
    monkeypatch.setattr("services.rag_engine.app._get_settings_file", lambda: p)
    monkeypatch.setattr("services.ingestion.storage.get_default_storage_root", lambda: tmp_path / "storage")
    return p


def secrets_path(settings_path):
    return settings_path.parent / "storage" / "secrets.json"


def test_secret_save_ignores_predictable_tmp_symlink(tmp_path):
    from packages.core.secrets_store import save_secrets

    secret_path = tmp_path / "secrets.json"
    predictable_tmp = tmp_path / "secrets.json.tmp"
    target = tmp_path / "unrelated.json"
    target.write_text("keep this file", encoding="utf-8")
    predictable_tmp.symlink_to(target)

    save_secrets(secret_path, {"test_api_key": "test-value"})

    assert target.read_text(encoding="utf-8") == "keep this file"
    assert predictable_tmp.is_symlink()
    assert not secret_path.is_symlink()
    assert json.loads(secret_path.read_text(encoding="utf-8"))["test_api_key"] == "test-value"
    assert secret_path.stat().st_mode & 0o777 == 0o600


@pytest.fixture()
def runtime_state():
    """Snapshot/restore the module-level runtime settings around each test."""
    from services.rag_engine import app as rag_app

    snapshot = dict(rag_app._runtime_llm_settings)
    yield rag_app._runtime_llm_settings
    rag_app._runtime_llm_settings.clear()
    rag_app._runtime_llm_settings.update(snapshot)


class TestMergePreservingSaved:
    """Unit-level contract of the merge-on-save helper."""

    def test_blank_never_wipes_saved_value(self, settings_path):
        from services.rag_engine.app import _save_persisted_settings

        _save_persisted_settings({"groq_api_key": ""})
        assert json.loads(secrets_path(settings_path).read_text())["groq_api_key"] == "sk-SAVED-GROQ"

    def test_masked_value_skipped(self, settings_path):
        from services.rag_engine.app import _save_persisted_settings

        _save_persisted_settings({"groq_api_key": "sk-ab...XYZ9", "litellm_base_url": "***"})
        data = json.loads(settings_path.read_text())
        assert "groq_api_key" not in data
        assert json.loads(secrets_path(settings_path).read_text())["groq_api_key"] == "sk-SAVED-GROQ"

    def test_real_new_value_overwrites(self, settings_path):
        from services.rag_engine.app import _save_persisted_settings

        _save_persisted_settings({"groq_api_key": "sk-NEW-VALUE"})
        assert "groq_api_key" not in json.loads(settings_path.read_text())
        secret_file = settings_path.parent / "storage" / "secrets.json"
        assert json.loads(secret_file.read_text())["groq_api_key"] == "sk-NEW-VALUE"

    def test_saves_secret_and_preferences_to_separate_files(self, settings_path):
        from services.rag_engine.app import _save_persisted_settings

        _save_persisted_settings({"groq_api_key": "sk-NEW-VALUE", "default_model": "new-model"})
        saved = json.loads(settings_path.read_text())
        secrets = json.loads((settings_path.parent / "storage" / "secrets.json").read_text())
        assert "groq_api_key" not in saved
        assert saved["default_model"] == "new-model"
        assert secrets["groq_api_key"] == "sk-NEW-VALUE"
        assert (settings_path.parent / "storage" / "secrets.json").stat().st_mode & 0o777 == 0o600

    def test_migrates_existing_persisted_secret(self, settings_path):
        from services.rag_engine.app import _load_persisted_settings

        migrated = _load_persisted_settings()
        secret_file = settings_path.parent / "storage" / "secrets.json"
        assert migrated["groq_api_key"] == "sk-SAVED-GROQ"
        assert "groq_api_key" not in json.loads(settings_path.read_text())
        assert json.loads(secret_file.read_text())["groq_api_key"] == "sk-SAVED-GROQ"

    def test_environment_secret_overrides_persisted_secret(self, settings_path, monkeypatch):
        from types import SimpleNamespace

        from services.rag_engine import app as rag_app

        monkeypatch.setattr(rag_app, "_core_get_settings", lambda: SimpleNamespace(
            provider=None, api_key=None, base_url=None, model=None,
            openai_api_key=None, openai_base_url=None, custom_base_url=None,
        ))
        _save = rag_app._save_persisted_settings
        _save({"active_provider": "openai", "openai_api_key": "persisted-secret"})
        monkeypatch.setattr(rag_app, "_core_get_settings", lambda: SimpleNamespace(
            provider=None, api_key=None, base_url=None, model=None,
            openai_api_key="environment-secret", openai_base_url=None, custom_base_url=None,
        ))
        old_runtime = dict(rag_app._runtime_llm_settings)
        try:
            rag_app._runtime_llm_settings.clear()
            rag_app._runtime_llm_settings.update(rag_app._load_persisted_settings())
            assert rag_app._resolve_active_llm_config_with_secrets()["api_key"] == "environment-secret"
        finally:
            rag_app._runtime_llm_settings.clear()
            rag_app._runtime_llm_settings.update(old_runtime)

    def test_uniform_rule_covers_non_key_fields(self, settings_path):
        from services.rag_engine.app import _save_persisted_settings

        _save_persisted_settings({"openai_org_id": "", "default_model": "", "custom_base_url": ""})
        data = json.loads(settings_path.read_text())
        assert data["openai_org_id"] == "org-SAVED"
        assert data["default_model"] == "gpt-4o-mini"
        assert data["custom_base_url"] == "http://localhost:9999/v1"

    def test_unknown_keys_still_persisted(self, settings_path):
        from services.rag_engine.app import _save_persisted_settings

        _save_persisted_settings({"brand_new_field": "v", "empty_new_field": ""})
        data = json.loads(settings_path.read_text())
        assert data["brand_new_field"] == "v"
        assert data["empty_new_field"] == ""  # nothing saved to protect


class TestSettingsEndpointPersistence:
    """Endpoint-level: POST /v1/settings/llm honors the same contract."""

    def test_blank_submission_preserves_saved_everywhere(self, settings_path, runtime_state):
        runtime_state.update(json.loads(settings_path.read_text()))
        from services.rag_engine.app import app

        client = TestClient(app)
        res = client.post(
            "/v1/settings/llm",
            headers=HDR,
            json={"groq_api_key": "", "openai_org_id": "", "default_model": ""},
        )
        assert res.status_code == 200

        disk = json.loads(settings_path.read_text())
        assert "groq_api_key" not in disk
        assert json.loads(secrets_path(settings_path).read_text())["groq_api_key"] == "sk-SAVED-GROQ"
        assert disk["openai_org_id"] == "org-SAVED"
        assert disk["default_model"] == "gpt-4o-mini"
        assert runtime_state["groq_api_key"] == "sk-SAVED-GROQ"
        assert runtime_state["openai_org_id"] == "org-SAVED"

    def test_masked_echo_preserves_saved_everywhere(self, settings_path, runtime_state):
        runtime_state.update(json.loads(settings_path.read_text()))
        from services.rag_engine.app import app

        client = TestClient(app)
        res = client.post(
            "/v1/settings/llm",
            headers=HDR,
            json={"groq_api_key": "sk-xy...1234"},
        )
        assert res.status_code == 200
        assert json.loads(secrets_path(settings_path).read_text())["groq_api_key"] == "sk-SAVED-GROQ"
        assert runtime_state["groq_api_key"] == "sk-SAVED-GROQ"

    def test_new_real_key_updates_disk_and_memory(self, settings_path, runtime_state):
        runtime_state.update(json.loads(settings_path.read_text()))
        from services.rag_engine.app import app

        client = TestClient(app)
        res = client.post("/v1/settings/llm", headers=HDR, json={"groq_api_key": "sk-FRESH"})
        assert res.status_code == 200
        assert "groq_api_key" not in json.loads(settings_path.read_text())
        assert json.loads(secrets_path(settings_path).read_text())["groq_api_key"] == "sk-FRESH"
        assert runtime_state["groq_api_key"] == "sk-FRESH"
