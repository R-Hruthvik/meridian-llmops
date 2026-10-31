import json

import httpx
import pytest

from packages.core.errors import ProviderError
from services.gateway.client import LiteLLMClient


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("provider", "base_url", "expected_url", "expected_auth", "expected_body"),
    [
        (
            "openai",
            "https://api.openai.com/v1",
            "https://api.openai.com/v1/chat/completions",
            "Bearer test-key",
            {
                "model": "m",
                "messages": [
                    {"role": "system", "content": "rules"},
                    {"role": "user", "content": "hi"},
                ],
                "temperature": 0.2,
                "max_tokens": 3,
                "stream": False,
            },
        ),
        (
            "anthropic",
            "https://api.anthropic.com/v1",
            "https://api.anthropic.com/v1/messages",
            None,
            {
                "model": "m",
                "messages": [{"role": "user", "content": "hi"}],
                "max_tokens": 3,
                "temperature": 0.2,
                "stream": False,
                "system": "rules",
            },
        ),
        (
            "openrouter",
            "https://openrouter.ai/api/v1",
            "https://openrouter.ai/api/v1/chat/completions",
            "Bearer test-key",
            {
                "model": "m",
                "messages": [
                    {"role": "system", "content": "rules"},
                    {"role": "user", "content": "hi"},
                ],
                "temperature": 0.2,
                "max_tokens": 3,
                "stream": False,
            },
        ),
        (
            "deepseek",
            "https://api.deepseek.com/v1",
            "https://api.deepseek.com/v1/chat/completions",
            "Bearer test-key",
            {
                "model": "m",
                "messages": [
                    {"role": "system", "content": "rules"},
                    {"role": "user", "content": "hi"},
                ],
                "temperature": 0.2,
                "max_tokens": 3,
                "stream": False,
            },
        ),
        (
            "groq",
            "https://api.groq.com/openai/v1",
            "https://api.groq.com/openai/v1/chat/completions",
            "Bearer test-key",
            {
                "model": "m",
                "messages": [
                    {"role": "system", "content": "rules"},
                    {"role": "user", "content": "hi"},
                ],
                "temperature": 0.2,
                "max_tokens": 3,
                "stream": False,
            },
        ),
        (
            "ollama",
            "http://localhost:11434/v1",
            "http://localhost:11434/v1/chat/completions",
            None,
            {
                "model": "m",
                "messages": [
                    {"role": "system", "content": "rules"},
                    {"role": "user", "content": "hi"},
                ],
                "temperature": 0.2,
                "max_tokens": 3,
                "stream": False,
            },
        ),
        (
            "custom",
            "https://llm.example/v1",
            "https://llm.example/v1/chat/completions",
            "Bearer test-key",
            {
                "model": "m",
                "messages": [
                    {"role": "system", "content": "rules"},
                    {"role": "user", "content": "hi"},
                ],
                "temperature": 0.2,
                "max_tokens": 3,
                "stream": False,
            },
        ),
    ],
)
async def test_provider_request_shapes(
    provider, base_url, expected_url, expected_auth, expected_body
):
    captured = {}

    async def handler(request):
        captured["url"] = str(request.url)
        captured["headers"] = request.headers
        captured["body"] = json.loads(request.content)
        if provider == "anthropic":
            return httpx.Response(
                200,
                json={
                    "model": "served",
                    "content": [{"type": "text", "text": "ok"}],
                    "usage": {"input_tokens": 1, "output_tokens": 1},
                },
            )
        return httpx.Response(
            200,
            json={
                "model": "served",
                "choices": [{"message": {"content": "ok"}}],
                "usage": {"total_tokens": 2},
            },
        )

    client = LiteLLMClient(
        transport=httpx.MockTransport(handler), allow_private_provider_urls=provider == "ollama"
    )
    try:
        result = await client.chat_completion(
            [{"role": "system", "content": "rules"}, {"role": "user", "content": "hi"}],
            model="m",
            temperature=0.2,
            max_tokens=3,
            provider=provider,
            api_key="test-key",
            base_url=base_url,
        )
    finally:
        await client.close()

    assert captured["url"] == expected_url
    assert captured["headers"].get("content-type") == "application/json"
    if provider == "anthropic":
        assert captured["headers"]["x-api-key"] == "test-key"
        assert captured["headers"]["anthropic-version"] == "2023-06-01"
    elif expected_auth:
        assert captured["headers"]["authorization"] == expected_auth
    else:
        assert "authorization" not in captured["headers"]
    assert captured["body"] == expected_body
    if provider == "anthropic":
        assert result["usage"] == {"input_tokens": 1, "output_tokens": 1}
    else:
        assert result["usage"] == {"total_tokens": 2}


@pytest.mark.asyncio
async def test_anthropic_base_ending_v1_is_not_duplicated():
    captured = []
    transport = httpx.MockTransport(
        lambda request: (
            captured.append(str(request.url))
            or httpx.Response(200, json={"content": [{"text": "ok"}]})
        )
    )
    client = LiteLLMClient(transport=transport)
    try:
        await client.chat_completion(
            [{"role": "user", "content": "hi"}],
            provider="anthropic",
            model="claude",
            api_key="test-api-key",
            base_url="https://api.anthropic.com/v1",
        )
    finally:
        await client.close()
    assert captured == ["https://api.anthropic.com/v1/messages"]


@pytest.mark.asyncio
async def test_missing_upstream_usage_is_none():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})
    )
    client = LiteLLMClient(transport=transport)
    try:
        result = await client.chat_completion(
            [{"role": "user", "content": "hi"}],
            provider="custom",
            model="m",
            api_key="test-api-key",
            base_url="https://llm.example/v1",
        )
    finally:
        await client.close()
    assert result["usage"] is None


@pytest.mark.asyncio
async def test_direct_provider_does_not_fall_back_to_litellm_key():
    client = LiteLLMClient(master_key="proxy-secret")
    with pytest.raises(Exception) as exc:
        await client.chat_completion(
            [{"role": "user", "content": "hi"}], provider="openai", model="m"
        )
    assert type(exc.value).__name__ == "ProviderConfigError"
    assert "proxy-secret" not in str(exc.value)


@pytest.mark.asyncio
async def test_proxy_route_may_use_litellm_master_key():
    seen = []
    transport = httpx.MockTransport(
        lambda request: (
            seen.append(request.headers.get("authorization"))
            or httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})
        )
    )
    client = LiteLLMClient(
        base_url="http://litellm.local",
        master_key="proxy-secret",
        transport=transport,
        allow_private_provider_urls=True,
    )
    try:
        await client.chat_completion(
            [{"role": "user", "content": "hi"}], provider="litellm", model="m"
        )
    finally:
        await client.close()
    assert seen == ["Bearer proxy-secret"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("base_url", "expected_url"),
    [
        ("http://litellm.local", "http://litellm.local/v1/chat/completions"),
        ("http://litellm.local/v1", "http://litellm.local/v1/chat/completions"),
        ("http://litellm.local/v1/chat/completions", "http://litellm.local/v1/chat/completions"),
    ],
)
async def test_litellm_url_is_normalized(base_url, expected_url):
    seen = []
    transport = httpx.MockTransport(
        lambda request: (
            seen.append(str(request.url))
            or httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})
        )
    )
    client = LiteLLMClient(
        base_url=base_url,
        master_key="proxy-key",
        transport=transport,
        allow_private_provider_urls=True,
    )
    try:
        await client.chat_completion(
            [{"role": "user", "content": "hi"}], provider="litellm", model="m"
        )
    finally:
        await client.close()
    assert seen == [expected_url]


@pytest.mark.asyncio
async def test_upstream_errors_and_success_payloads_redact_configured_key():
    key = "secret-test-value"
    transport = httpx.MockTransport(lambda request: httpx.Response(401, text=f"invalid key: {key}"))
    client = LiteLLMClient(transport=transport)
    with pytest.raises(ProviderError) as error:
        await client.chat_completion(
            [{"role": "user", "content": "hi"}],
            provider="custom",
            model="m",
            api_key=key,
            base_url="https://llm.example/v1",
        )
    assert key not in str(error.value)
    assert key not in (error.value.provider_message or "")
    await client.close()

    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200, json={"choices": [{"message": {"content": f"echo {key}"}}]}
        )
    )
    client = LiteLLMClient(transport=transport)
    try:
        result = await client.chat_completion(
            [{"role": "user", "content": "hi"}],
            provider="custom",
            model="m",
            api_key=key,
            base_url="https://llm.example/v1",
        )
    finally:
        await client.close()
    assert result["choices"][0]["message"]["content"] == "echo [REDACTED]"
    assert key not in str(result["raw_response"])


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "chunk",
    ["[]", '"scalar"', '{"choices":"bad"}', '{"choices":[4]}', '{"choices":[{"delta":"bad"}]}'],
)
async def test_malformed_sse_chunk_is_a_typed_provider_error(chunk):
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, text=f"data: {chunk}\n\ndata: [DONE]\n\n")
    )
    client = LiteLLMClient(transport=transport)
    try:
        with pytest.raises(ProviderError, match="invalid completion response"):
            await client.chat_completion(
                [{"role": "user", "content": "hi"}],
                provider="custom",
                model="m",
                api_key="key-test",
                base_url="https://llm.example/v1",
            )
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_short_key_is_redacted_in_upstream_error_message():
    key = "abc"
    transport = httpx.MockTransport(lambda request: httpx.Response(401, text=f"rejected {key}"))
    client = LiteLLMClient(transport=transport)
    try:
        with pytest.raises(ProviderError) as error:
            await client.chat_completion(
                [{"role": "user", "content": "hi"}],
                provider="custom",
                model="m",
                api_key=key,
                base_url="https://llm.example/v1",
            )
    finally:
        await client.close()
    assert key not in (error.value.provider_message or "")


@pytest.mark.asyncio
async def test_sse_redacts_completion_and_raw_body_without_losing_model_metadata():
    key = "secret-stream-key"
    chunk = json.dumps(
        {"model": "upstream-model", "choices": [{"delta": {"content": f"echo {key}"}}]}
    )
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, text=f"data: {chunk}\n\ndata: [DONE]\n\n")
    )
    client = LiteLLMClient(transport=transport)
    try:
        result = await client.chat_completion(
            [{"role": "user", "content": "hi"}],
            provider="custom",
            model="requested",
            api_key=key,
            base_url="https://llm.example/v1",
        )
    finally:
        await client.close()
    assert result["model"] == "upstream-model"
    assert result["choices"][0]["message"]["content"] == "echo [REDACTED]"
    assert result["raw_response"]["model"] == "upstream-model"
    assert key not in str(result["raw_response"])


@pytest.mark.asyncio
async def test_short_key_is_redacted_from_json_completion_and_raw_response():
    key = "k"
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200, json={"model": "safe-model", "choices": [{"message": {"content": f"value {key}"}}]}
        )
    )
    client = LiteLLMClient(transport=transport)
    try:
        result = await client.chat_completion(
            [{"role": "user", "content": "hi"}],
            provider="custom",
            model="requested",
            api_key=key,
            base_url="https://llm.example/v1",
        )
    finally:
        await client.close()
    assert result["model"] == "safe-model"
    assert result["choices"][0]["message"]["content"] == "value [REDACTED]"
    assert key not in str(result["raw_response"])


@pytest.mark.asyncio
async def test_short_key_is_redacted_from_sse_completion_and_raw_response():
    key = "Q"
    chunk = json.dumps(
        {"model": "upstream-model", "choices": [{"delta": {"content": f"echo {key}"}}]}
    )
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, text=f"data: {chunk}\n\ndata: [DONE]\n\n")
    )
    client = LiteLLMClient(transport=transport)
    try:
        result = await client.chat_completion(
            [{"role": "user", "content": "hi"}],
            provider="custom",
            model="requested",
            api_key=key,
            base_url="https://llm.example/v1",
        )
    finally:
        await client.close()
    assert result["model"] == "upstream-model"
    assert result["choices"][0]["message"]["content"] == "echo [REDACTED]"
    assert result["raw_response"]["model"] == "upstream-model"
    assert key not in str(result["raw_response"])


@pytest.mark.asyncio
async def test_short_key_is_redacted_from_transport_exception_message():
    key = "Q"

    def handler(request):
        raise httpx.ConnectError(f"connection failed using {key}", request=request)

    client = LiteLLMClient(transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(ProviderError) as error:
            await client.chat_completion(
                [{"role": "user", "content": "hi"}],
                provider="custom",
                model="m",
                api_key=key,
                base_url="https://llm.example/v1",
            )
    finally:
        await client.close()
    assert key not in (error.value.provider_message or "")


@pytest.mark.asyncio
async def test_unknown_provider_is_a_typed_configuration_error():
    client = LiteLLMClient()
    with pytest.raises(Exception) as exc:
        await client.chat_completion(
            [{"role": "user", "content": "hi"}],
            provider="madeup",
            model="m",
            api_key="test-api-key",
            base_url="https://example.test",
        )
    assert type(exc.value).__name__ == "ProviderConfigError"


@pytest.mark.asyncio
async def test_provider_retries_one_transient_failure():
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(429, json={"error": "busy"}, headers={"Retry-After": "0"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    client = LiteLLMClient(transport=httpx.MockTransport(handler))
    try:
        result = await client.chat_completion(
            [{"role": "user", "content": "hi"}],
            provider="custom",
            model="m",
            api_key="test-api-key",
            base_url="https://llm.example/v1",
        )
    finally:
        await client.close()
    assert len(calls) == 2
    assert result["choices"][0]["message"]["content"] == "ok"


@pytest.mark.asyncio
async def test_provider_timeout_and_invalid_or_empty_responses_are_typed():
    client = LiteLLMClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, content=b"not json"))
    )
    try:
        http = client._get_client()
        assert http.timeout.connect == 5
        assert http.timeout.read == 60
        with pytest.raises(ProviderError, match="invalid completion response"):
            await client.chat_completion(
                [{"role": "user", "content": "hi"}],
                provider="custom",
                model="m",
                api_key="test-api-key",
                base_url="https://llm.example/v1",
            )
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_empty_completion_is_a_typed_provider_error():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json={"choices": [{"message": {"content": " "}}]})
    )
    client = LiteLLMClient(transport=transport)
    with pytest.raises(ProviderError, match="empty completion"):
        await client.chat_completion(
            [{"role": "user", "content": "hi"}],
            provider="custom",
            model="m",
            api_key="test-api-key",
            base_url="https://llm.example/v1",
        )
    assert client.served_snapshot() == (1, "custom", "m", "m", False)
    await client.close()
