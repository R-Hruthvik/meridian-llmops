"""FastAPI Gateway Application."""

from fastapi import Depends, FastAPI, HTTPException, status
from pydantic import BaseModel, Field

from packages.core.config import get_settings
from packages.core.models import GuardrailResult
from services.gateway.auth import verify_api_key
from services.gateway.client import LiteLLMClient
from services.gateway.guardrails.input_rails import InputGuardrails

app = FastAPI(
    title="Meridian AI Gateway",
    version="0.1.0",
    description="Enterprise AI Gateway: Provider Routing, Rate Limiting, and NeMo Input Guardrails",
)

guardrails = InputGuardrails()
litellm_client = LiteLLMClient()


class ChatCompletionRequest(BaseModel):
    model: str = "gpt-4o-mini"
    messages: list[dict[str, str]]
    temperature: float = 0.0
    max_tokens: int = 1000


class GuardrailCheckRequest(BaseModel):
    text: str = Field(..., min_length=1)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "meridian-gateway"}


@app.post("/v1/guardrails/check", response_model=GuardrailResult)
async def check_guardrails(
    payload: GuardrailCheckRequest,
    tenant_id: str = Depends(verify_api_key),
):
    """Explicit endpoint to evaluate text against input guardrails."""
    return guardrails.evaluate(payload.text)


@app.post("/v1/chat/completions")
async def chat_completions(
    req: ChatCompletionRequest,
    tenant_id: str = Depends(verify_api_key),
):
    """Proxy chat completions through input guardrails and LiteLLM."""
    settings = get_settings()

    # Apply input guardrails to user messages if enabled
    if settings.enable_input_guardrails:
        for msg in req.messages:
            if msg.get("role") == "user":
                result = guardrails.evaluate(msg.get("content", ""))
                if not result.allowed:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Prompt injection detected: {', '.join(result.policy_violations)}",
                    )
                # Replace content with sanitized version
                msg["content"] = result.sanitized_text

    # Route to LiteLLM
    response = await litellm_client.chat_completion(
        messages=req.messages,
        model=req.model,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
    )
    return response
