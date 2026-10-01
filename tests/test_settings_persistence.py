"""Regression tests for non-destructive provider-config persistence (wayfinder T3).

Locks the merge-on-save contract: blank or masked submissions must never clobber
saved provider credentials/endpoints, in memory or on disk.
"""

import json

import pytest
from fastapi.testclient import TestClient

HDR = {"X-API-Key": "meridian-test-secret-key-2026"}


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
    return p


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
        assert json.loads(settings_path.read_text())["groq_api_key"] == "sk-SAVED-GROQ"

    def test_masked_value_skipped(self, settings_path):
        from services.rag_engine.app import _save_persisted_settings

        _save_persisted_settings({"groq_api_key": "sk-ab...XYZ9", "litellm_base_url": "***"})
        data = json.loads(settings_path.read_text())
        assert data["groq_api_key"] == "sk-SAVED-GROQ"

    def test_real_new_value_overwrites(self, settings_path):
        from services.rag_engine.app import _save_persisted_settings

        _save_persisted_settings({"groq_api_key": "sk-NEW-VALUE"})
        assert json.loads(settings_path.read_text())["groq_api_key"] == "sk-NEW-VALUE"

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
        assert disk["groq_api_key"] == "sk-SAVED-GROQ"
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
        assert json.loads(settings_path.read_text())["groq_api_key"] == "sk-SAVED-GROQ"
        assert runtime_state["groq_api_key"] == "sk-SAVED-GROQ"

    def test_new_real_key_updates_disk_and_memory(self, settings_path, runtime_state):
        runtime_state.update(json.loads(settings_path.read_text()))
        from services.rag_engine.app import app

        client = TestClient(app)
        res = client.post("/v1/settings/llm", headers=HDR, json={"groq_api_key": "sk-FRESH"})
        assert res.status_code == 200
        assert json.loads(settings_path.read_text())["groq_api_key"] == "sk-FRESH"
        assert runtime_state["groq_api_key"] == "sk-FRESH"
