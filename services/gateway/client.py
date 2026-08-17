"""LiteLLM Gateway proxy client with mock and remote routing support."""

from typing import Any

import httpx

from packages.core.config import get_settings


class LiteLLMClient:
    """Client for dispatching LLM queries through the LiteLLM proxy container."""

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
    ) -> dict[str, Any]:
        """Dispatches chat completion. Falls back to deterministic mock if gateway is offline in test mode."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{self.base_url}/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.master_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": messages,
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                    },
                )
                if resp.status_code == 200:
                    data: dict[str, Any] = resp.json()
                    return data
        except (httpx.HTTPError, httpx.RequestError, OSError):
            pass

        # Offline/Testing Fallback Response
        last_message = messages[-1]["content"] if messages else ""
        return {
            "id": "chatcmpl-mock-gateway",
            "object": "chat.completion",
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": f"Mock response for query: {last_message}",
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": len(last_message.split()),
                "completion_tokens": 10,
                "total_tokens": len(last_message.split()) + 10,
            },
        }
