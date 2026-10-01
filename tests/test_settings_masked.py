def test_post_never_returns_raw_key():
    d = {"groq_api_key": "sk-SAVED-GROQ"}
    from services.rag_engine.app import masked_llm_view
    v = masked_llm_view(d)
    assert "sk-SAVED-GROQ" not in str(v)
    assert v["groq_api_key"]["configured"] is True
    assert v["groq_api_key"]["hint"] == "GROQ"


def test_short_key_emits_star_hint():
    from services.rag_engine.app import masked_llm_view
    for short in ("abcd", "ab"):
        v = masked_llm_view({"groq_api_key": short})
        assert short not in str(v)
        assert v["groq_api_key"] == {"configured": True, "hint": "****"}


def test_falsy_value_emits_not_configured():
    from services.rag_engine.app import masked_llm_view
    assert masked_llm_view({"groq_api_key": ""})["groq_api_key"] == {"configured": False}
    assert masked_llm_view({"groq_api_key": None})["groq_api_key"] == {"configured": False}


def test_masked_view_shares_secret_suffix():
    import inspect

    from packages.core.secrets_store import SECRET_SUFFIX
    from services.rag_engine import app as rag_app
    assert "SECRET_SUFFIX" in inspect.getsource(rag_app.masked_llm_view) or rag_app.SECRET_SUFFIX == SECRET_SUFFIX


"""Endpoint no-leak tests (follow test_settings_persistence.py fixture patterns)."""

import json

import pytest
from fastapi.testclient import TestClient

HDR = {"X-API-Key": "meridian-test-secret-key-2026"}


@pytest.fixture()
def settings_path(tmp_path, monkeypatch):
    p = tmp_path / "settings.json"
    p.write_text(json.dumps({"groq_api_key": "sk-SAVED-GROQ-AAAA", "default_model": "gpt-4o-mini"}))
    monkeypatch.setenv("APP_ENV", "testing")
    monkeypatch.setattr("services.rag_engine.app._get_settings_file", lambda: p)
    return p


@pytest.fixture()
def runtime_state():
    from services.rag_engine import app as rag_app

    snapshot = dict(rag_app._runtime_llm_settings)
    yield rag_app._runtime_llm_settings
    rag_app._runtime_llm_settings.clear()
    rag_app._runtime_llm_settings.update(snapshot)


def test_post_response_contains_no_key_material(settings_path, runtime_state):
    runtime_state.update(json.loads(settings_path.read_text()))
    from services.rag_engine.app import app

    client = TestClient(app)
    res = client.post("/v1/settings/llm", headers=HDR, json={"groq_api_key": "sk-FRESH-KEY-BBBB"})
    assert res.status_code == 200
    assert "sk-FRESH-KEY-BBBB" not in res.text
    assert "sk-SAVED-GROQ-AAAA" not in res.text
    assert res.json()["groq_api_key"]["configured"] is True


def test_get_response_contains_no_key_material(settings_path, runtime_state):
    runtime_state.update(json.loads(settings_path.read_text()))
    from services.rag_engine.app import app

    client = TestClient(app)
    res = client.get("/v1/settings/llm", headers=HDR)
    assert res.status_code == 200
    assert "sk-SAVED-GROQ-AAAA" not in res.text
