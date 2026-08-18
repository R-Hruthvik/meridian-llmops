"""LLM Client routing requests to LiteLLM Gateway, Groq, OpenAI, Anthropic, or Ollama."""

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
        }

        if target_provider == "anthropic":
            endpoint = f"{target_base}/v1/messages" if "anthropic.com" in target_base else f"{target_base}/v1/chat/completions"
            if "anthropic.com" in target_base:
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
                }
                if system_prompt:
                    payload["system"] = system_prompt
            else:
                endpoint = f"{target_base}/v1/chat/completions"
                headers["Authorization"] = f"Bearer {target_key}"
                payload = {
                    "model": target_model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                }
        else:
            # OpenAI / Groq / OpenRouter / DeepSeek / Ollama / LiteLLM standard chat/completions
            endpoint = f"{target_base}/chat/completions" if target_base.endswith("/v1") else f"{target_base}/v1/chat/completions"
            if target_key:
                headers["Authorization"] = f"Bearer {target_key}"
            payload = {
                "model": target_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }

        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(endpoint, headers=headers, json=payload)
                if resp.status_code == 200:
                    data: dict[str, Any] = resp.json()
                    # Normalize Anthropic response format if needed
                    if "content" in data and isinstance(data["content"], list) and len(data["content"]) > 0:
                        text_content = data["content"][0].get("text", "")
                        return {
                            "id": data.get("id", "anthropic-cmpl"),
                            "object": "chat.completion",
                            "model": target_model,
                            "choices": [
                                {
                                    "index": 0,
                                    "message": {"role": "assistant", "content": text_content},
                                    "finish_reason": "stop",
                                }
                            ],
                            "usage": data.get("usage", {"total_tokens": 50}),
                        }
                    return data
                else:
                    logger.error(
                        "LLM API Response %d - %s: %s",
                        resp.status_code,
                        endpoint,
                        resp.text[:150],
                    )
                    raise httpx.HTTPStatusError(
                        f"LLM API returned status {resp.status_code}",
                        response=resp,
                        request=resp.request,
                    )
        except (httpx.HTTPError, httpx.RequestError, OSError, ValueError, KeyError) as e:
            logger.error("LLM Connection Error - %s: %s", endpoint, e)
            raise
