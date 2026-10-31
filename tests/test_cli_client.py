"""Unit tests for the Meridian CLI HTTP client."""

import json

import httpx
import pytest

from meridian_cli.client import (
    MeridianAPIError,
    MeridianClient,
    MeridianConnectionError,
)


def test_health_request_shape_and_auth():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["url"] = str(request.url)
        seen["api_key"] = request.headers.get("x-api-key")
        return httpx.Response(200, json={"status": "healthy", "service": "meridian"})

    transport = httpx.MockTransport(handler)
    client = MeridianClient(base_url="http://example", api_key="user-key", transport=transport)
    data = client.health()
    assert data == {"status": "healthy", "service": "meridian"}
    assert seen["method"] == "GET"
    assert seen["url"] == "http://example/health"
    assert seen["api_key"] == "user-key"


def test_admin_header_used_for_settings():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("x-api-key") == "admin-key"
        assert request.url.path == "/v1/settings/llm"
        return httpx.Response(200, json={"active_provider": "custom"})

    transport = httpx.MockTransport(handler)
    client = MeridianClient(base_url="http://example", admin_key="admin-key", transport=transport)
    assert client.settings_show() == {"active_provider": "custom"}


def test_retrieve_request_shape():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/v1/retrieve"
        body = json.loads(request.content)
        assert body == {"query": "hello", "top_k": 3, "debug": False}
        return httpx.Response(200, json={"chunks": [], "top_k": 3})

    transport = httpx.MockTransport(handler)
    client = MeridianClient(base_url="http://example", api_key="u", transport=transport)
    data = client.retrieve("hello", top_k=3)
    assert data["top_k"] == 3


def test_query_stream_parses_sse():
    sse = 'event: token\ndata: {"delta":"hi"}\n\nevent: done\ndata: {"answer":"hi","request_id":"r1"}\n\n'

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/query/stream"
        body = json.loads(request.content)
        assert body == {"query": "q", "top_k": 2}
        return httpx.Response(200, text=sse, headers={"content-type": "text/event-stream"})

    transport = httpx.MockTransport(handler)
    client = MeridianClient(base_url="http://example", api_key="u", transport=transport)
    events = list(client.query_stream("q", top_k=2))
    assert events == [("token", {"delta": "hi"}), ("done", {"answer": "hi", "request_id": "r1"})]


def test_http_error_raises_api_error():
    transport = httpx.MockTransport(lambda r: httpx.Response(404, json={"detail": "missing"}))
    client = MeridianClient(base_url="http://example", api_key="u", transport=transport)
    with pytest.raises(MeridianAPIError):
        client.health()


def test_connection_error_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    transport = httpx.MockTransport(handler)
    client = MeridianClient(base_url="http://example", api_key="u", transport=transport)
    with pytest.raises(MeridianConnectionError):
        client.health()


def test_models_list_request():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/settings/llm/test-and-fetch-models"
        body = json.loads(request.content)
        assert body["provider"] == "openai"
        assert body["api_key"] == "sk-test"
        return httpx.Response(200, json={"models": ["gpt-4o"], "success": True})

    transport = httpx.MockTransport(handler)
    client = MeridianClient(base_url="http://example", admin_key="admin", transport=transport)
    data = client.models_list("openai", api_key="sk-test")
    assert data["models"] == ["gpt-4o"]


def test_settings_set_provider_request():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["active_provider"] == "custom"
        assert body["default_model"] == "m"
        assert body["model"] == "m"
        assert body["base_url"] == "http://x"
        assert body["api_key"] == "k"
        return httpx.Response(200, json={"active_provider": "custom"})

    transport = httpx.MockTransport(handler)
    client = MeridianClient(base_url="http://example", admin_key="admin", transport=transport)
    data = client.settings_set_provider("custom", "m", base_url="http://x", api_key="k")
    assert data["active_provider"] == "custom"
