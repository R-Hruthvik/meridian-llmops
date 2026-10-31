"""Provider-aware async client for chat completions."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from packages.core.config import get_settings
from packages.core.errors import ProviderConfigError, ProviderError
from services.gateway.providers import PROVIDERS
from services.gateway.safe_http import (
    PinnedAsyncHTTPTransport,
    ProviderURLNotAllowed,
    validate_provider_url,
)

logger = logging.getLogger("meridian.gateway.client")


class LiteLLMClient:
    """Dispatch chat completions to LiteLLM or a supported direct provider."""

    def __init__(
        self,
        base_url: str | None = None,
        master_key: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        allow_private_provider_urls: bool | None = None,
    ):
        settings = get_settings()
        self.base_url = base_url or settings.litellm_base_url
        self.master_key = master_key or settings.litellm_master_key
        self._transport = transport
        self.allow_private_provider_urls = (
            settings.allow_private_provider_urls
            if allow_private_provider_urls is None
            else allow_private_provider_urls
        )
        self._safe_transport: PinnedAsyncHTTPTransport | None = None
        self._client: httpx.AsyncClient | None = None
        self._served_seq = 0
        self._last_served: dict[str, Any] | None = None
        self.last_response: dict[str, Any] | None = None

    def served_snapshot(self) -> tuple[int, str | None, str | None, str | None, bool]:
        served = self._last_served or {}
        return (
            self._served_seq,
            served.get("provider"),
            served.get("model"),
            served.get("requested"),
            bool(served.get("has_content")),
        )

    def _record_served(self, provider: str, model: str, requested: str, has_content: bool) -> None:
        self._served_seq += 1
        self._last_served = {
            "provider": provider,
            "model": model,
            "requested": requested,
            "has_content": has_content,
        }

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            transport = self._transport
            if transport is None:
                if self._safe_transport is None:
                    self._safe_transport = PinnedAsyncHTTPTransport()
                transport = self._safe_transport
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(connect=5.0, read=60.0, write=60.0, pool=5.0),
                limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
                follow_redirects=False,
                trust_env=False,
                transport=transport,
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
            if self._transport is None:
                self._safe_transport = None

    @staticmethod
    def _endpoint(provider: str, base_url: str) -> str:
        if provider == "litellm":
            base = base_url.rstrip("/")
            if base.endswith("/chat/completions"):
                return base
            return (
                f"{base}/chat/completions"
                if base.endswith("/v1")
                else f"{base}/v1/chat/completions"
            )
        spec = PROVIDERS[provider]
        base = base_url.rstrip("/")
        if base.endswith(spec["path"]):
            return base
        if provider == "anthropic" and base.endswith("/v1"):
            base = base[:-3]
        return f"{base}{spec['path']}"

    @staticmethod
    def _redact(value: Any, secret: str | None) -> Any:
        if not secret:
            return value
        if isinstance(value, str):
            return value.replace(secret, "[REDACTED]")
        if isinstance(value, list):
            return [LiteLLMClient._redact(item, secret) for item in value]
        if isinstance(value, dict):
            return {key: LiteLLMClient._redact(item, secret) for key, item in value.items()}
        return value

    @staticmethod
    def _redact_literal(value: str, secret: str | None) -> str:
        return value.replace(secret, "[REDACTED]") if secret else value

    @staticmethod
    def _extract(
        data: dict[str, Any], provider: str
    ) -> tuple[str, str | None, dict[str, Any] | None]:
        model = data.get("model") if isinstance(data.get("model"), str) else None
        usage = data.get("usage") if isinstance(data.get("usage"), dict) else None
        if provider == "anthropic":
            content_blocks = data.get("content")
            content = "".join(
                block.get("text", "") for block in content_blocks or [] if isinstance(block, dict)
            )
            return content, model, usage
        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            choice = choices[0]
            if not isinstance(choice, dict):
                raise ValueError("invalid completion choice")
            message = choice.get("message")
            if isinstance(message, dict):
                content = message.get("content", "")
                if isinstance(content, list):
                    content = "".join(
                        part.get("text", "") for part in content if isinstance(part, dict)
                    )
                if not isinstance(content, str):
                    raise TypeError("invalid completion content")
                if not content.strip():
                    for key in ("reasoning", "reasoning_content"):
                        candidate = message.get(key)
                        if isinstance(candidate, str) and candidate.strip():
                            content = candidate
                            break
                    if not content.strip():
                        details = message.get("reasoning_details")
                        if isinstance(details, list):
                            pieces = [d.get("text", "") for d in details if isinstance(d, dict)]
                            joined = "".join(pieces).strip()
                            if joined:
                                content = joined
                return content, model, usage
            text = choice.get("text", "")
            if isinstance(text, str):
                return text, model, usage
            raise ValueError("invalid completion content")
        if isinstance(data.get("response"), str):
            return data["response"], model, usage
        raise ValueError("missing completion choices")

    def _build_request(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: float,
        max_tokens: int,
        provider: str | None,
        api_key: str | None,
        base_url: str | None,
        stream: bool = False,
    ) -> tuple[str, dict[str, str], dict[str, Any], str | None, str]:
        """Resolve provider, endpoint, headers, and JSON body for a completion call."""
        target_provider = (provider or "litellm").lower()
        if target_provider not in (*PROVIDERS, "litellm"):
            raise ProviderConfigError(target_provider, f"Unknown LLM provider: {target_provider}")
        is_proxy = target_provider == "litellm"
        if is_proxy:
            spec = None
            configured_base = base_url or self.base_url
        else:
            spec = PROVIDERS[target_provider]
            configured_base = base_url or spec["base_url_default"]
        target_base = configured_base.rstrip("/")
        target_key = (api_key or self.master_key) if is_proxy else api_key
        if spec is not None and spec["auth_style"] != "none" and not target_key:
            raise ProviderConfigError(
                target_provider, f"API key is required for provider {target_provider}"
            )
        if not target_base:
            raise ProviderConfigError(
                target_provider, f"Base URL is required for provider {target_provider}"
            )
        endpoint = self._endpoint(target_provider, target_base)
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if target_key and (spec is None or spec["auth_style"] != "none"):
            if spec is not None and spec["auth_style"] == "anthropic":
                headers.update({"x-api-key": target_key, "anthropic-version": "2023-06-01"})
            else:
                headers["Authorization"] = f"Bearer {target_key}"
        if spec is not None and spec["request_format"] == "anthropic":
            payload_messages = [m for m in messages if m.get("role") != "system"]
            payload: dict[str, Any] = {
                "model": model,
                "messages": payload_messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "stream": stream,
            }
            system_prompt = "\n".join(
                m.get("content", "") for m in messages if m.get("role") == "system"
            )
            if system_prompt:
                payload["system"] = system_prompt
        else:
            payload = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": stream,
            }
        return endpoint, headers, payload, target_key, target_provider

    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        model: str = "gpt-4o-mini",
        temperature: float = 0.0,
        max_tokens: int = 1000,
        provider: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> dict[str, Any]:
        endpoint, headers, payload, target_key, target_provider = self._build_request(
            messages, model, temperature, max_tokens, provider, api_key, base_url
        )
        try:
            _, host, port, addresses = validate_provider_url(
                target_provider,
                endpoint,
                allow_private=self.allow_private_provider_urls,
                resolve=self._transport is None,
            )
        except ProviderURLNotAllowed as error:
            raise ProviderConfigError(target_provider, "Provider URL is not allowed") from error
        if self._transport is None:
            if self._safe_transport is None:
                self._safe_transport = PinnedAsyncHTTPTransport()
            assert self._safe_transport is not None
            self._safe_transport.address_backend.pin(host, port, addresses)
            self._get_client()

        for attempt in range(3):
            try:
                resp = await self._get_client().post(endpoint, headers=headers, json=payload)
                if resp.status_code in (429, *range(500, 600)) and attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                if resp.status_code < 200 or resp.status_code >= 300:
                    provider_message = self._redact_literal(resp.text, target_key)[:500]
                    status = 429 if resp.status_code == 429 else 502
                    raise ProviderError(
                        target_provider,
                        status,
                        f"Provider {target_provider} returned HTTP {resp.status_code}",
                        provider_message,
                    )
                try:
                    if resp.text.lstrip().startswith("data:") or "\ndata:" in resp.text:
                        parts: list[str] = []
                        upstream_model = None
                        usage = None
                        for line in resp.text.splitlines():
                            line = line.strip()
                            if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                                continue
                            chunk = self._redact(json.loads(line[5:].strip()), target_key)
                            if not isinstance(chunk, dict):
                                raise TypeError("stream chunk must be a JSON object")
                            if (
                                upstream_model is None
                                and isinstance(chunk.get("model"), str)
                                and chunk["model"].strip()
                            ):
                                upstream_model = chunk["model"].strip()
                            choices = chunk.get("choices", [])
                            if not isinstance(choices, list):
                                raise TypeError("stream choices must be a list")
                            for choice in choices:
                                if not isinstance(choice, dict):
                                    raise TypeError("stream choice must be a JSON object")
                                delta = choice.get("delta", {})
                                if not isinstance(delta, dict):
                                    raise TypeError("stream delta must be a JSON object")
                                piece = delta.get("content", "")
                                if isinstance(piece, list):
                                    piece = "".join(
                                        part.get("text", "")
                                        for part in piece
                                        if isinstance(part, dict)
                                    )
                                if not isinstance(piece, str):
                                    raise TypeError("stream content must be text")
                                parts.append(piece)
                            if isinstance(chunk.get("usage"), dict):
                                usage = chunk["usage"]
                        data = {
                            "choices": [{"message": {"content": "".join(parts)}}],
                            "usage": usage,
                            "model": upstream_model,
                        }
                        content = "".join(parts)
                    else:
                        data = resp.json()
                        if not isinstance(data, dict):
                            raise ValueError("response must be a JSON object")
                        data = self._redact(data, target_key)
                        content, upstream_model, usage = self._extract(data, target_provider)
                except (json.JSONDecodeError, ValueError, TypeError) as exc:
                    raise ProviderError(
                        target_provider,
                        502,
                        f"Provider {target_provider} returned an invalid completion response",
                        str(exc),
                    ) from exc
                served_model = upstream_model or model
                self._record_served(target_provider, served_model, model, bool(content.strip()))
                self.last_response = {
                    "provider": target_provider,
                    "requested_model": model,
                    "model": served_model,
                    "raw": data,
                }
                if not content.strip():
                    raise ProviderError(
                        target_provider,
                        502,
                        f"Provider {target_provider} returned an empty completion",
                    )
                return {
                    "id": data.get("id", "cmpl-response"),
                    "object": "chat.completion",
                    "model": served_model,
                    "provider": target_provider,
                    "requested_model": model,
                    "raw_response": data,
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": content},
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": usage,
                }
            except ProviderError:
                raise
            except httpx.HTTPError as exc:
                self._client = None
                raise ProviderError(
                    target_provider,
                    502,
                    f"Provider {target_provider} request failed",
                    self._redact_literal(str(exc), target_key),
                ) from exc
        raise ProviderError(target_provider, 502, f"Provider {target_provider} request failed")

    @staticmethod
    def _stream_model(chunk: dict[str, Any], provider: str) -> str | None:
        if provider == "anthropic":
            message = chunk.get("message")
            if isinstance(message, dict) and isinstance(message.get("model"), str):
                return message["model"].strip() or None
            return None
        model = chunk.get("model")
        return model.strip() if isinstance(model, str) and model.strip() else None

    @staticmethod
    def _stream_deltas(chunk: dict[str, Any], provider: str) -> list[str]:
        if provider == "anthropic":
            delta = chunk.get("delta")
            if not isinstance(delta, dict):
                return []
            text = delta.get("text", "")
            if not isinstance(text, str):
                raise TypeError("stream content must be text")
            return [text] if text else []
        choices = chunk.get("choices", [])
        if not isinstance(choices, list):
            raise TypeError("stream choices must be a list")
        pieces: list[str] = []
        for choice in choices:
            if not isinstance(choice, dict):
                raise TypeError("stream choice must be a JSON object")
            delta = choice.get("delta", {})
            if not isinstance(delta, dict):
                raise TypeError("stream delta must be a JSON object")
            piece = delta.get("content", "")
            if isinstance(piece, list):
                piece = "".join(part.get("text", "") for part in piece if isinstance(part, dict))
            if not isinstance(piece, str) or not piece.strip():
                for key in ("reasoning", "reasoning_content"):
                    candidate = delta.get(key)
                    if isinstance(candidate, str) and candidate.strip():
                        piece = candidate
                        break
                if not (isinstance(piece, str) and piece.strip()):
                    details = delta.get("reasoning_details")
                    if isinstance(details, list):
                        joined = "".join(
                            d.get("text", "") for d in details if isinstance(d, dict)
                        ).strip()
                        if joined:
                            piece = joined
            if not isinstance(piece, str):
                raise TypeError("stream content must be text")
            pieces.append(piece)
        return pieces

    async def chat_completion_stream(
        self,
        messages: list[dict[str, str]],
        model: str = "gpt-4o-mini",
        temperature: float = 0.0,
        max_tokens: int = 1000,
        provider: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> AsyncIterator[str]:
        """Yield assistant text deltas from a provider's streaming completion."""
        endpoint, headers, payload, target_key, target_provider = self._build_request(
            messages, model, temperature, max_tokens, provider, api_key, base_url, stream=True
        )
        headers["Accept"] = "text/event-stream"
        try:
            _, host, port, addresses = validate_provider_url(
                target_provider,
                endpoint,
                allow_private=self.allow_private_provider_urls,
                resolve=self._transport is None,
            )
        except ProviderURLNotAllowed as error:
            raise ProviderConfigError(target_provider, "Provider URL is not allowed") from error
        if self._transport is None:
            if self._safe_transport is None:
                self._safe_transport = PinnedAsyncHTTPTransport()
            assert self._safe_transport is not None
            self._safe_transport.address_backend.pin(host, port, addresses)
            self._get_client()

        upstream_model: str | None = None
        has_content = False
        try:
            async with self._get_client().stream(
                "POST", endpoint, headers=headers, json=payload
            ) as response:
                if response.status_code < 200 or response.status_code >= 300:
                    body = (await response.aread()).decode("utf-8", "replace")
                    provider_message = self._redact_literal(body, target_key)[:500]
                    status = 429 if response.status_code == 429 else 502
                    raise ProviderError(
                        target_provider,
                        status,
                        f"Provider {target_provider} returned HTTP {response.status_code}",
                        provider_message,
                    )
                async for line in response.aiter_lines():
                    stripped = line.strip()
                    if not stripped.startswith("data:"):
                        continue
                    raw = stripped[5:].strip()
                    if not raw or raw == "[DONE]":
                        continue
                    try:
                        chunk = self._redact(json.loads(raw), target_key)
                    except json.JSONDecodeError as exc:
                        raise ProviderError(
                            target_provider,
                            502,
                            f"Provider {target_provider} returned an invalid completion response",
                            str(exc),
                        ) from exc
                    if not isinstance(chunk, dict):
                        raise ProviderError(
                            target_provider,
                            502,
                            f"Provider {target_provider} returned an invalid completion response",
                            "stream chunk must be a JSON object",
                        )
                    upstream_model = upstream_model or self._stream_model(chunk, target_provider)
                    try:
                        pieces = self._stream_deltas(chunk, target_provider)
                    except TypeError as exc:
                        raise ProviderError(
                            target_provider,
                            502,
                            f"Provider {target_provider} returned an invalid completion response",
                            str(exc),
                        ) from exc
                    for piece in pieces:
                        if piece:
                            has_content = True
                            yield piece
        except ProviderError:
            raise
        except httpx.HTTPError as exc:
            self._client = None
            raise ProviderError(
                target_provider,
                502,
                f"Provider {target_provider} request failed",
                self._redact_literal(str(exc), target_key),
            ) from exc
        self._record_served(target_provider, upstream_model or model, model, has_content)
        self.last_response = {
            "provider": target_provider,
            "requested_model": model,
            "model": upstream_model or model,
            "raw": None,
        }
