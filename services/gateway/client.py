"""LLM Client routing requests to LiteLLM Gateway, Groq, OpenAI, Anthropic, or Ollama."""

import json
import logging
from typing import Any

import httpx

logger = logging.getLogger("meridian.gateway.client")

from packages.core.config import get_settings


class LiteLLMClient:
    """Client for dispatching LLM queries through LiteLLM Gateway or direct provider endpoints."""

    def __init__(self, base_url: str | None = None, master_key: str | None = None):
        settings = get_settings()
        self.base_url = base_url or settings.litellm_base_url
        self.master_key = master_key or settings.litellm_master_key

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
        """Dispatches chat completion to configured provider (Groq, OpenAI, Anthropic, Ollama, LiteLLM)."""
        target_base = (base_url or self.base_url).rstrip("/")
        target_key = api_key or self.master_key
        target_model = model or "gpt-4o-mini"
        target_provider = (provider or "openai").lower()

        # Build endpoint URL and headers based on provider
        headers: dict[str, str] = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        if target_base.endswith(("/chat/completions", "/messages")):
            endpoint = target_base
        elif target_provider == "anthropic":
            endpoint = f"{target_base}/v1/messages" if "anthropic.com" in target_base else f"{target_base}/v1/chat/completions"
        elif target_base.endswith("/v1"):
            endpoint = f"{target_base}/chat/completions"
        else:
            endpoint = f"{target_base}/v1/chat/completions"

        if target_provider == "anthropic" and "anthropic.com" in target_base:
            headers["x-api-key"] = target_key or ""
            headers["anthropic-version"] = "2023-06-01"
            # Transform messages for Anthropic
            system_prompt = ""
            user_messages = []
            for m in messages:
                if m.get("role") == "system":
                    system_prompt = m.get("content", "")
                else:
                    user_messages.append(m)

            payload: dict[str, Any] = {
                "model": target_model,
                "messages": user_messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "stream": False,
            }
            if system_prompt:
                payload["system"] = system_prompt
        else:
            # OpenAI / Groq / OpenRouter / DeepSeek / Ollama / LiteLLM standard chat/completions
            if target_key:
                headers["Authorization"] = f"Bearer {target_key}"
            payload = {
                "model": target_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": False,
            }

        try:
            async with httpx.AsyncClient(timeout=25.0) as client:
                resp = await client.post(endpoint, headers=headers, json=payload)
                if resp.status_code == 200:
                    raw_text = resp.text.strip()
                    content = ""
                    upstream_usage: dict[str, Any] | None = None

                    # Check if response is Server-Sent Events (SSE / streaming)
                    if raw_text.startswith("data:") or "\ndata:" in raw_text:
                        extracted_parts = []
                        for line in raw_text.splitlines():
                            line = line.strip()
                            if line.startswith("data:") and not line.endswith("[DONE]"):
                                json_str = line[5:].strip()
                                if json_str:
                                    try:
                                        chunk = json.loads(json_str)
                                        choices = chunk.get("choices", [])
                                        if choices:
                                            delta = choices[0].get("delta", {})
                                            if isinstance(delta, dict):
                                                part = delta.get("content") or delta.get("text") or ""
                                                if part:
                                                    extracted_parts.append(part)
                                        # Capture usage if streamed final chunk includes it
                                        if "usage" in chunk and isinstance(chunk["usage"], dict):
                                            upstream_usage = chunk["usage"]
                                    except (json.JSONDecodeError, ValueError):
                                        continue
                        content = "".join(extracted_parts)
                    else:
                        # Standard JSON response
                        try:
                            data: dict[str, Any] = resp.json()
                            if "usage" in data and isinstance(data["usage"], dict):
                                upstream_usage = data["usage"]
                            if "choices" in data and isinstance(data["choices"], list) and len(data["choices"]) > 0:
                                choice = data["choices"][0]
                                if isinstance(choice, dict):
                                    if "message" in choice and isinstance(choice["message"], dict):
                                        content = choice["message"].get("content", "")
                                    elif "text" in choice:
                                        content = choice.get("text", "")
                                    elif "delta" in choice and isinstance(choice["delta"], dict):
                                        content = choice["delta"].get("content", "")
                                elif isinstance(choice, str):
                                    content = choice
                            elif "content" in data and isinstance(data["content"], list) and len(data["content"]) > 0:
                                content = data["content"][0].get("text", "")
                            elif "response" in data and isinstance(data["response"], str):
                                content = data["response"]
                            elif "message" in data and isinstance(data["message"], dict):
                                content = data["message"].get("content", "")
                        except (json.JSONDecodeError, ValueError):
                            content = raw_text

                    if upstream_usage and isinstance(upstream_usage, dict) and "total_tokens" in upstream_usage:
                        usage: dict[str, Any] = dict(upstream_usage)
                    else:
                        if upstream_usage is None:
                            logger.warning(
                                "Upstream %s (%s) missing usage field, estimating tokens",
                                target_provider,
                                target_model,
                            )
                        usage = {"total_tokens": len(content.split()) + 50, "estimated": True}
                        if upstream_usage:
                            usage.update({k: v for k, v in upstream_usage.items() if k != "total_tokens"})

                    return {
                        "id": "cmpl-response",
                        "object": "chat.completion",
                        "model": target_model,
                        "choices": [
                            {
                                "index": 0,
                                "message": {"role": "assistant", "content": content},
                                "finish_reason": "stop",
                            }
                        ],
                        "usage": usage,
                    }
                else:
                    error_preview = resp.text[:200]
                    logger.error(
                        "LLM API Response %d - %s: %s",
                        resp.status_code,
                        endpoint,
                        error_preview,
                    )
                    raise httpx.HTTPStatusError(
                        f"LLM API ({target_provider} / {target_model}) returned HTTP {resp.status_code}: {error_preview}",
                        response=resp,
                        request=resp.request,
                    )
        except (httpx.HTTPError, httpx.RequestError, OSError, ValueError, KeyError) as e:
            logger.error("LLM Connection Error - %s: %s", endpoint, e)
            raise
