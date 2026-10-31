"""Streaming chat-completion contract for the gateway provider client."""

import json

import httpx
import pytest

from packages.core.errors import ProviderError
from services.gateway.client import LiteLLMClient


def _sse(*chunks: dict) -> str:
    lines = [f"data: {json.dumps(chunk)}\n\n" for chunk in chunks]
    lines.append("data: [DONE]\n\n")
    return "".join(lines)


@pytest.mark.asyncio
async def test_stream_yields_incremental_deltas_in_order():
    body = _sse(
        {"model": "upstream-model", "choices": [{"delta": {"content": "Hel"}}]},
        {"model": "upstream-model", "choices": [{"delta": {"content": "lo "}}]},
        {"model": "upstream-model", "choices": [{"delta": {"content": "world"}}]},
    )
    seen: list[dict] = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, text=body)

    client = LiteLLMClient(transport=httpx.MockTransport(handler))
    try:
        deltas = [
            delta
            async for delta in client.chat_completion_stream(
                [{"role": "user", "content": "hi"}],
                provider="custom",
                model="m",
                api_key="k",
                base_url="https://llm.example/v1",
            )
        ]
    finally:
        await client.close()

    assert deltas == ["Hel", "lo ", "world"]
    assert seen[0]["stream"] is True
    assert client.served_snapshot() == (1, "custom", "upstream-model", "m", True)


@pytest.mark.asyncio
async def test_stream_redacts_key_and_reports_http_errors():
    key = "stream-secret-key"

    def handler(request):
        return httpx.Response(401, text=f"invalid key: {key}")

    client = LiteLLMClient(transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(ProviderError) as error:
            async for _ in client.chat_completion_stream(
                [{"role": "user", "content": "hi"}],
                provider="custom",
                model="m",
                api_key=key,
                base_url="https://llm.example/v1",
            ):
                pass
    finally:
        await client.close()
    assert key not in str(error.value)
    assert key not in (error.value.provider_message or "")


@pytest.mark.asyncio
async def test_stream_handles_anthropic_content_block_deltas():
    body = _sse(
        {"type": "message_start", "message": {"model": "claude-served"}},
        {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hel"}},
        {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "lo"}},
    )
    client = LiteLLMClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, text=body))
    )
    try:
        deltas = [
            delta
            async for delta in client.chat_completion_stream(
                [{"role": "user", "content": "hi"}],
                provider="anthropic",
                model="claude",
                api_key="k",
                base_url="https://api.anthropic.com",
            )
        ]
    finally:
        await client.close()
    assert deltas == ["Hel", "lo"]
    assert client.served_snapshot() == (1, "anthropic", "claude-served", "claude", True)


@pytest.mark.asyncio
async def test_stream_malformed_chunk_is_a_typed_provider_error():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200, text='data: {"choices":[{"delta":"bad"}]}\n\ndata: [DONE]\n\n'
        )
    )
    client = LiteLLMClient(transport=transport)
    try:
        with pytest.raises(ProviderError, match="invalid completion response"):
            async for _ in client.chat_completion_stream(
                [{"role": "user", "content": "hi"}],
                provider="custom",
                model="m",
                api_key="k",
                base_url="https://llm.example/v1",
            ):
                pass
    finally:
        await client.close()
