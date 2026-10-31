"""FastAPI Gateway Application."""

from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from packages.core.config import get_settings, validate_production
from packages.core.errors import ProviderError
from packages.core.models import GuardrailResult
from services.gateway.auth import validate_auth_configuration, verify_api_key
from services.gateway.client import LiteLLMClient
from services.gateway.guardrails.input_rails import InputGuardrails

guardrails = InputGuardrails()
litellm_client = LiteLLMClient()


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_auth_configuration()
    validate_production(get_settings())
    yield
    await litellm_client.close()


app = FastAPI(
    title="Meridian AI Gateway",
    version="0.1.0",
    description="AI Gateway with provider routing, rate limiting, and rule-based input guardrails",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


class ChatCompletionRequest(BaseModel):
    model: str = "gpt-4o-mini"
    messages: list[dict[str, str]]
    temperature: float = 0.0
    max_tokens: int = 1000


class GuardrailCheckRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=100000)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    response.headers.setdefault("Content-Security-Policy", "default-src 'self'")
    return response


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "meridian-gateway"}


@app.get("/v1/guardrails/check", response_model=GuardrailResult)
async def check_guardrails_get(
    text: str,
    tenant_id: str = Depends(verify_api_key),
):
    """Explicit endpoint to evaluate text against input guardrails."""
    return guardrails.evaluate(text)


@app.post("/v1/guardrails/check", response_model=GuardrailResult, include_in_schema=False)
async def check_guardrails_post(
    payload: GuardrailCheckRequest,
    tenant_id: str = Depends(verify_api_key),
):
    """Deprecated alias for GET /v1/guardrails/check. Use query parameter instead."""
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
    try:
        response = await litellm_client.chat_completion(
            messages=req.messages,
            model=req.model,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )
    except ProviderError as e:
        raise HTTPException(
            status_code=e.status,
            detail=f"LLM provider error: {e.message}",
        )
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"LLM provider error: {e}",
        )
    return response
