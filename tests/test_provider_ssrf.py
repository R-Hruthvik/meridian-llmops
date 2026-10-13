import socket

import pytest

from packages.core.errors import ProviderConfigError
from services.gateway.client import LiteLLMClient


def _resolve_to(monkeypatch, *addresses):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda host, port, **kwargs: [
            (socket.AF_INET6 if ":" in address else socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, port))
            for address in addresses
        ],
    )


class _Response:
    status_code = 200
    text = '{"choices":[{"message":{"content":"ok"}}]}'

    def json(self):
        return {"choices": [{"message": {"content": "ok"}}]}


class _HTTPClient:
    def __init__(self):
        self.requests = []

    async def post(self, endpoint, **kwargs):
        self.requests.append((endpoint, kwargs))
        return _Response()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "http://provider.example/v1",
        "https://127.0.0.1/v1",
        "https://169.254.169.254/latest/meta-data",
        "https://user:pass@provider.example/v1",
        "https://provider.example/v1?token=x",
        "https://provider.example/v1#fragment",
    ],
)
async def test_generation_rejects_unsafe_provider_urls_before_post(url, monkeypatch):
    _resolve_to(monkeypatch, "127.0.0.1" if "127.0.0.1" in url else "169.254.169.254")
    client = LiteLLMClient(allow_private_provider_urls=False)
    fake_http = _HTTPClient()
    monkeypatch.setattr(client, "_get_client", lambda: fake_http)

    with pytest.raises(ProviderConfigError, match="URL is not allowed"):
        await client.chat_completion(
            [{"role": "user", "content": "hello"}],
            provider="custom",
            model="test-model",
            api_key="test-key",
            base_url=url,
        )
    assert fake_http.requests == []


@pytest.mark.asyncio
async def test_generation_allows_remote_https_custom_provider_and_pins_resolution(monkeypatch):
    _resolve_to(monkeypatch, "93.184.216.34")
    client = LiteLLMClient(allow_private_provider_urls=False)
    fake_http = _HTTPClient()
    monkeypatch.setattr(client, "_get_client", lambda: fake_http)

    result = await client.chat_completion(
        [{"role": "user", "content": "hello"}],
        provider="custom",
        model="test-model",
        api_key="test-key",
        base_url="https://provider.example/v1",
    )

    assert result["choices"][0]["message"]["content"] == "ok"
    assert fake_http.requests[0][0] == "https://provider.example/v1/chat/completions"
    assert client._safe_transport.address_backend._addresses[("provider.example", 443)] == (
        "93.184.216.34",
    )


@pytest.mark.asyncio
async def test_generation_rejects_private_litellm_proxy_without_opt_in(monkeypatch):
    _resolve_to(monkeypatch, "169.254.169.254")
    client = LiteLLMClient(allow_private_provider_urls=False)
    fake_http = _HTTPClient()
    monkeypatch.setattr(client, "_get_client", lambda: fake_http)

    with pytest.raises(ProviderConfigError, match="URL is not allowed"):
        await client.chat_completion(
            [{"role": "user", "content": "hello"}],
            provider="litellm",
            model="test-model",
            api_key="test-key",
            base_url="http://169.254.169.254/v1",
        )

    assert fake_http.requests == []


@pytest.mark.asyncio
async def test_generation_allows_loopback_litellm_proxy_without_private_opt_in(monkeypatch):
    _resolve_to(monkeypatch, "127.0.0.1")
    client = LiteLLMClient(allow_private_provider_urls=False)
    fake_http = _HTTPClient()
    monkeypatch.setattr(client, "_get_client", lambda: fake_http)

    result = await client.chat_completion(
        [{"role": "user", "content": "hello"}],
        provider="litellm",
        model="test-model",
        api_key="test-key",
        base_url="http://localhost:4000/v1",
    )

    assert result["choices"][0]["message"]["content"] == "ok"
    assert fake_http.requests[0][0] == "http://localhost:4000/v1/chat/completions"


@pytest.mark.asyncio
async def test_generation_allows_compose_litellm_service_without_private_opt_in(monkeypatch):
    _resolve_to(monkeypatch, "172.20.0.5")
    client = LiteLLMClient(allow_private_provider_urls=False)
    fake_http = _HTTPClient()
    monkeypatch.setattr(client, "_get_client", lambda: fake_http)

    result = await client.chat_completion(
        [{"role": "user", "content": "hello"}],
        provider="litellm",
        model="test-model",
        api_key="test-key",
        base_url="http://litellm:4000/v1",
    )

    assert result["choices"][0]["message"]["content"] == "ok"
    assert fake_http.requests[0][0] == "http://litellm:4000/v1/chat/completions"


@pytest.mark.asyncio
async def test_generation_allows_local_ollama_only_when_private_urls_are_enabled(monkeypatch):
    _resolve_to(monkeypatch, "127.0.0.1")
    client = LiteLLMClient(allow_private_provider_urls=True)
    fake_http = _HTTPClient()
    monkeypatch.setattr(client, "_get_client", lambda: fake_http)

    result = await client.chat_completion(
        [{"role": "user", "content": "hello"}],
        provider="ollama",
        model="local-model",
        base_url="http://localhost:11434/v1",
    )

    assert result["choices"][0]["message"]["content"] == "ok"
    assert fake_http.requests[0][0] == "http://localhost:11434/v1/chat/completions"


@pytest.mark.asyncio
async def test_generation_rejects_mixed_public_and_private_dns_answers(monkeypatch):
    _resolve_to(monkeypatch, "93.184.216.34", "10.0.0.8")
    client = LiteLLMClient(allow_private_provider_urls=False)
    fake_http = _HTTPClient()
    monkeypatch.setattr(client, "_get_client", lambda: fake_http)

    with pytest.raises(ProviderConfigError, match="URL is not allowed"):
        await client.chat_completion(
            [{"role": "user", "content": "hello"}],
            provider="custom",
            model="test-model",
            api_key="test-key",
            base_url="https://provider.example/v1",
        )
    assert fake_http.requests == []


@pytest.mark.asyncio
async def test_generation_connects_only_to_the_validated_dns_answer(monkeypatch):
    answers = iter(("93.184.216.34", "127.0.0.1"))
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda host, port, **kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", (next(answers), port))
        ],
    )
    client = LiteLLMClient(allow_private_provider_urls=False)
    fake_http = _HTTPClient()
    monkeypatch.setattr(client, "_get_client", lambda: fake_http)

    await client.chat_completion(
        [{"role": "user", "content": "hello"}],
        provider="custom",
        model="test-model",
        api_key="test-key",
        base_url="https://provider.example/v1",
    )

    connected = []

    class Network:
        async def connect_tcp(self, host, port, **kwargs):
            connected.append((host, port))
            return "connected"

        async def connect_unix_socket(self, path, **kwargs):
            raise AssertionError("provider requests must use TCP")

        async def sleep(self, seconds):
            return None

    client._safe_transport.address_backend._network_backend = Network()
    await client._safe_transport.address_backend.connect_tcp("provider.example", 443)
    assert connected == [("93.184.216.34", 443)]


def test_provider_http_client_does_not_follow_redirects(monkeypatch):
    _resolve_to(monkeypatch, "93.184.216.34")
    client = LiteLLMClient(allow_private_provider_urls=False)
    assert client._get_client().follow_redirects is False
