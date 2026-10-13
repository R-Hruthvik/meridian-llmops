"""Security regressions for model-fetch URL validation and response handling."""

import asyncio
import socket

import pytest


def _resolved_to(monkeypatch, ip):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0))],
    )


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/models",
        "https://user:pass@example.com/models",
        "https://example.com/models?token=x",
        "https://example.com/models#fragment",
    ],
)
def _call_fetch(monkeypatch, provider, url, *, status_code=200, chunks=None):
    from services.rag_engine import app as rag_app

    calls = []
    client_options = {}

    class Response:
        def __init__(self):
            self.status_code = status_code
            self.headers = {"location": "http://127.0.0.1/secret"} if status_code == 302 else {}

        def json(self):
            return {"data": [{"id": "model"}], "models": [{"name": "model"}]}

        @property
        def text(self):
            body = b"".join(chunks) if chunks else b""
            return body.decode(errors="replace")

        async def aiter_bytes(self):
            for chunk in chunks or [b'{"data":[{"id":"model"}],"models":[{"name":"model"}]}']:
                yield chunk

    class Stream:
        async def __aenter__(self):
            return Response()

        async def __aexit__(self, *args):
            return None

    class Client:
        def __init__(self, **kwargs):
            client_options.update(kwargs)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        def stream(self, method, target, **kwargs):
            calls.append(target)
            return Stream()

        async def get(self, target, **kwargs):
            calls.append(target)
            return Response()

    monkeypatch.setattr(rag_app.httpx, "AsyncClient", lambda **kwargs: Client(**kwargs))
    req = rag_app.TestAndFetchModelsRequest(provider=provider, base_url=url, api_key="test-key")
    result = asyncio.run(rag_app.test_and_fetch_models(req, "operations"))
    return result, calls, client_options


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/models",
        "https://user:pass@example.com/models",
        "https://example.com/models?token=x",
        "https://example.com/models#fragment",
    ],
)
def test_model_fetch_rejects_unsafe_url_components(url, monkeypatch):
    _resolved_to(monkeypatch, "93.184.216.34")
    result, calls, _ = _call_fetch(monkeypatch, "openai", url)
    assert calls == []
    assert result["success"] is False


@pytest.mark.parametrize("ip", ["10.1.2.3", "169.254.1.1", "0.0.0.0", "224.0.0.1", "192.0.2.1"])
def test_model_fetch_rejects_non_public_resolved_addresses(ip, monkeypatch):
    _resolved_to(monkeypatch, ip)
    result, calls, _ = _call_fetch(monkeypatch, "openai", "https://provider.example")
    assert calls == []
    assert result["success"] is False


def test_non_local_provider_rejects_loopback(monkeypatch):
    _resolved_to(monkeypatch, "127.0.0.1")
    result, calls, _ = _call_fetch(monkeypatch, "openai", "http://127.0.0.1")
    assert calls == []
    assert result["success"] is False


def test_model_fetch_transport_uses_only_the_validated_address(monkeypatch):
    import asyncio

    from services.rag_engine import app as rag_app

    calls = []

    class FakeNetwork:
        async def connect_tcp(self, host, port, **kwargs):
            calls.append((host, port))
            return "connected"

        async def connect_unix_socket(self, path, **kwargs):
            raise AssertionError("model-fetch transport must use TCP")

        async def sleep(self, seconds):
            return None

    resolution = iter(("93.184.216.34", "127.0.0.1"))
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", (next(resolution), 0))
        ],
    )
    validated_url, validated_host, validated_port, validated_addresses = rag_app._validate_model_fetch_url(
        "openai", "https://provider.example/models"
    )
    backend = rag_app._PinnedAddressBackend(FakeNetwork())
    backend.pin(validated_host, validated_port, validated_addresses)

    assert asyncio.run(backend.connect_tcp(validated_host, validated_port)) == "connected"
    assert calls == [("93.184.216.34", 443)]
    assert validated_url == "https://provider.example/models"


@pytest.mark.parametrize(
    "url",
    ["http://localhost:11434", "http://127.0.0.1:8000/v1", "http://[::1]:8000/v1"],
)
@pytest.mark.parametrize("provider", ["ollama", "custom", "openai_compatible"])
def test_local_providers_allow_loopback_urls(provider, url, monkeypatch):
    host = "::1" if "[::1]" in url else "127.0.0.1"
    _resolved_to(monkeypatch, host)
    result, calls, _ = _call_fetch(monkeypatch, provider, url)
    assert calls
    assert result["success"] is True


def test_model_fetch_disables_redirects(monkeypatch):
    _resolved_to(monkeypatch, "93.184.216.34")
    result, calls, client_options = _call_fetch(
        monkeypatch, "openai", "https://provider.example", status_code=302
    )
    assert calls == ["https://provider.example/models"]
    assert client_options.get("follow_redirects") is False
    assert result["success"] is False


def test_model_fetch_pins_the_checked_dns_result(monkeypatch):
    resolutions = []

    def resolve(host, port, **kwargs):
        resolutions.append(host)
        ip = "93.184.216.34" if len(resolutions) == 1 else "127.0.0.1"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    result, calls, client_options = _call_fetch(
        monkeypatch, "openai", "https://provider.example"
    )

    transport = client_options["transport"]
    assert result["success"] is True
    assert calls == ["https://provider.example/models"]
    assert resolutions == ["provider.example"]
    assert transport.address_backend._addresses[("provider.example", 443)] == (
        "93.184.216.34",
    )


def test_model_fetch_caps_response_body_and_does_not_echo_it(monkeypatch):
    _resolved_to(monkeypatch, "93.184.216.34")
    marker = b"private-response-marker"
    result, _, _ = _call_fetch(
        monkeypatch,
        "openai",
        "https://provider.example",
        chunks=[b"x" * (1024 * 1024), marker],
    )
    assert result["success"] is False
    assert marker.decode() not in result["message"]
    assert "provider.example" not in result["message"]


def test_model_fetch_rejects_json_request_over_one_mib(monkeypatch):
    from fastapi.testclient import TestClient

    from services.rag_engine import app as rag_app

    rag_app.app.dependency_overrides[rag_app.require_admin] = lambda: "operations"
    try:
        response = TestClient(rag_app.app).post(
            "/v1/settings/llm/test-and-fetch-models",
            json={"provider": "ollama", "padding": "x" * (1024 * 1024)},
        )
    finally:
        rag_app.app.dependency_overrides.clear()
    assert response.status_code == 413
