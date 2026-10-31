"""Unit tests for Meridian CLI commands."""

import json

import httpx
from typer.testing import CliRunner

from meridian_cli import client as client_module
from meridian_cli.main import app

runner = CliRunner()


def _patch_client(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    original = client_module.MeridianClient

    def factory(**kwargs):
        return original(transport=transport, **kwargs)

    monkeypatch.setattr(client_module, "MeridianClient", factory)
    return transport


def test_health_json_success(monkeypatch):
    def handler(request):
        return httpx.Response(200, json={"status": "healthy", "service": "meridian-rag-engine"})

    _patch_client(monkeypatch, handler)
    result = runner.invoke(app, ["--json", "health"], env={"MERIDIAN_BASE_URL": "http://test"})
    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["ok"] is True
    assert payload["data"]["status"] == "healthy"


def test_health_failure_exit_one(monkeypatch):
    def handler(request):
        return httpx.Response(500, json={"detail": "boom"})

    _patch_client(monkeypatch, handler)
    result = runner.invoke(app, ["health"], env={"MERIDIAN_BASE_URL": "http://test"})
    assert result.exit_code == 1


def test_retrieve_json(monkeypatch):
    def handler(request):
        body = json.loads(request.content)
        assert body["query"] == "hello"
        assert body["top_k"] == 4
        return httpx.Response(
            200, json={"query": "hello", "top_k": 4, "chunks": [{"chunk_id": "c1"}]}
        )

    _patch_client(monkeypatch, handler)
    result = runner.invoke(
        app,
        ["--json", "retrieve", "hello", "--top-k", "4"],
        env={"MERIDIAN_BASE_URL": "http://test", "MERIDIAN_API_KEY": "u"},
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["ok"] is True
    assert len(payload["data"]["chunks"]) == 1


def test_query_json(monkeypatch):
    def handler(request):
        body = json.loads(request.content)
        assert body["query"] == "what?"
        assert body["top_k"] == 2
        return httpx.Response(200, json={"answer": "42", "query": "what?"})

    _patch_client(monkeypatch, handler)
    result = runner.invoke(
        app,
        ["--json", "query", "what?", "--top-k", "2"],
        env={"MERIDIAN_BASE_URL": "http://test", "MERIDIAN_API_KEY": "u"},
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["ok"] is True
    assert payload["data"]["answer"] == "42"


def test_query_stream(monkeypatch):
    sse = 'event: token\ndata: {"delta":"hi"}\n\nevent: done\ndata: {"answer":"hi","request_id":"r1"}\n\n'

    def handler(request):
        return httpx.Response(200, text=sse, headers={"content-type": "text/event-stream"})

    _patch_client(monkeypatch, handler)
    result = runner.invoke(
        app,
        ["query", "q", "--stream"],
        env={"MERIDIAN_BASE_URL": "http://test", "MERIDIAN_API_KEY": "u"},
    )
    assert result.exit_code == 0, result.output
    assert "hi" in result.output


def test_settings_show_json(monkeypatch):
    def handler(request):
        assert request.url.path == "/v1/settings/llm"
        return httpx.Response(200, json={"active_provider": "custom", "default_model": "m"})

    _patch_client(monkeypatch, handler)
    result = runner.invoke(
        app,
        ["--json", "settings", "show"],
        env={"MERIDIAN_BASE_URL": "http://test", "MERIDIAN_ADMIN_API_KEY": "admin"},
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["ok"] is True


def test_settings_test_failure(monkeypatch):
    def handler(request):
        return httpx.Response(200, json={"status": "error", "success": False, "message": "bad"})

    _patch_client(monkeypatch, handler)
    result = runner.invoke(
        app,
        ["settings", "test"],
        env={"MERIDIAN_BASE_URL": "http://test", "MERIDIAN_ADMIN_API_KEY": "admin"},
    )
    assert result.exit_code == 1


def test_settings_set_provider(monkeypatch):
    def handler(request):
        body = json.loads(request.content)
        assert body["active_provider"] == "custom"
        assert body["default_model"] == "m"
        return httpx.Response(200, json={"active_provider": "custom"})

    _patch_client(monkeypatch, handler)
    result = runner.invoke(
        app,
        [
            "settings",
            "set-provider",
            "--provider",
            "custom",
            "--model",
            "m",
            "--base-url",
            "http://x",
            "--api-key",
            "k",
        ],
        env={"MERIDIAN_BASE_URL": "http://test", "MERIDIAN_ADMIN_API_KEY": "admin"},
    )
    assert result.exit_code == 0, result.output


def test_models_list(monkeypatch):
    def handler(request):
        body = json.loads(request.content)
        assert body["provider"] == "openai"
        return httpx.Response(200, json={"models": ["gpt-4o"], "success": True})

    _patch_client(monkeypatch, handler)
    result = runner.invoke(
        app,
        ["models", "list", "--provider", "openai"],
        env={"MERIDIAN_BASE_URL": "http://test", "MERIDIAN_ADMIN_API_KEY": "admin"},
    )
    assert result.exit_code == 0, result.output


def test_smoke_success(monkeypatch):
    def handler(request):
        if request.url.path == "/health":
            return httpx.Response(200, json={"status": "healthy"})
        if request.url.path == "/v1/retrieve":
            return httpx.Response(200, json={"chunks": []})
        if request.url.path == "/v1/query":
            return httpx.Response(200, json={"answer": "ok"})
        return httpx.Response(404)

    _patch_client(monkeypatch, handler)
    result = runner.invoke(
        app,
        ["smoke"],
        env={"MERIDIAN_BASE_URL": "http://test", "MERIDIAN_API_KEY": "u"},
    )
    assert result.exit_code == 0, result.output


def test_smoke_failure(monkeypatch):
    def handler(request):
        return httpx.Response(500, json={"detail": "nope"})

    _patch_client(monkeypatch, handler)
    result = runner.invoke(
        app,
        ["smoke"],
        env={"MERIDIAN_BASE_URL": "http://test", "MERIDIAN_API_KEY": "u"},
    )
    assert result.exit_code == 1


def test_ingest_missing_dir_propagates(monkeypatch):
    result = runner.invoke(app, ["ingest", "/no/such/dir", "--recursive"])
    assert result.exit_code != 0
