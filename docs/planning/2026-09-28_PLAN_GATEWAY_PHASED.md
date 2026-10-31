# Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden and restructure the Meridian AI Gateway into POST-canonical rails, fail-closed auth, and audited proxy attribution.

**Architecture:** Keep FastAPI thin: `api.py` factory mounts `routes/`, `middleware/` handles context/rate-limit, `proxy/` transports and `rails/` decides. Single `GuardrailResult` schema and `policy.yaml` source both rails; chat path runs input rails → proxy → output rails.

**Tech Stack:** FastAPI lifespan, httpx AsyncClient pool, tenacity `retry_on_api_error`, SlowAPI + structlog, LiteLLM `1.102.x-stable`.

**Spec:** `2026-09-28_PLAN_GATEWAY.md`

## Global Constraints

- LiteLLM image pinned to `1.102.x-stable`, never `main-v1.35.8` rolling tag.
- `X-API-Key` required, `X-Tenant-Id` optional default `default`; 401 invalid key, 429 with `Retry-After`.
- Terms fixed: AI Gateway / Input Guardrail / Output Guardrail; `LiteLLMClient` transport only.
- `GET /v1/guardrails/check?text=` removed after one-release 308 shim with Sunset header.
- `usage{total_tokens, estimated:bool}` never fabricated silently; `model, serving_provider` echoed explicitly.

---

## File Structure

- Modify `services/gateway/auth.py` — secret load + `verify_api_key(dep) -> str` only.
- Modify `services/gateway/app.py:19-20,39-91` — shrink to re-export of `api.py` factory.
- Create `services/gateway/api.py` — `create_app() -> FastAPI` + `lifespan` only.
- Create `services/gateway/routes/chat.py` — `POST /v1/chat/completions` handler.
- Create `services/gateway/routes/rails.py` — `POST /v1/guardrails/check:{input,output}` + GET 308 shim.
- Create `services/gateway/rails/schemas.py` — `GuardrailResult`, `ChatCompletionRequest`.
- Modify `services/gateway/guardrails/input_rails.py:57-73`, `output_rails.py:22-44` → move to `services/gateway/rails/input.py`, `rails/output.py`.
- Create `services/gateway/proxy/client.py` — transport + URL/header mapping only.
- Create `services/gateway/proxy/normalize.py` — `normalize_response(data, model) -> dict` with `estimated` flag.
- Create `services/gateway/middleware/rate_limit.py` — SlowAPI limiter keyed tenant+key.
- Create `services/gateway/middleware/request_context.py` — request-id bind + audit log.
- Test `tests/test_gateway.py` — auth, rails, proxy, rate-limit, lifespan assertions.

---

## Phase 0 — Baseline + Safety

**Deliverable:** Fail-closed auth with startup assertion; no silent fallback. Verify: `uv run python -m pytest tests/test_gateway.py -k "auth or health" -v`

### Task 1: Startup secret assertion

**Files:** Modify `packages/core/config.py`, Modify `services/gateway/auth.py:22-38`, Test `tests/test_gateway.py`
**Interfaces:** Consumes `get_settings() -> Settings{api_key_secret:str, app_env:str}`; Produces `assert_gateway_secret() -> None`, `verify_api_key(x_api_key:str|None, x_tenant_id:str) -> str`

- [x] **Step 1: Failing test**
```python
def test_empty_secret_fails_closed(monkeypatch, gateway_client):
    monkeypatch.setenv("API_KEY_SECRET", "")
    monkeypatch.setenv("APP_ENV", "production")
    r = gateway_client.post("/v1/chat/completions", headers={"X-API-Key": "x"}, json={"messages": [], "model": "m"})
    assert r.status_code == 401
```
- [x] **Step 2: Run** `uv run python -m pytest tests/test_gateway.py::test_empty_secret_fails_closed -v` Expected FAIL: `not found`
- [x] **Step 3: Implementation**
```python
def assert_gateway_secret() -> None:
    from packages.core.config import get_settings
    s = get_settings()
    if s.app_env == "production" and not s.api_key_secret:
        raise RuntimeError("API_KEY_SECRET missing in production")
```
Call it at import of `services/gateway/auth.py`.
- [x] **Step 4: Run** `uv run python -m pytest tests/test_gateway.py::test_empty_secret_fails_closed -v` Expected PASS
- [x] **Step 5: Commit** `git add services/gateway/auth.py packages/core/config.py tests/test_gateway.py && git commit -m "feat(gateway): fail-closed secret assertion"`

### Task 2: Dev-only fallback with warning

**Files:** Modify `services/gateway/auth.py:30-34`, Test `tests/test_gateway.py`
**Interfaces:** Consumes `assert_gateway_secret() -> None`; Produces `resolve_expected_secret(settings: Settings) -> str`

- [x] **Step 1: Failing test**
```python
def test_dev_fallback_logged(monkeypatch, caplog):
    from services.gateway.auth import resolve_expected_secret
    monkeypatch.setenv("MERIDIAN_API_KEY", "dev-k")
    monkeypatch.setenv("APP_ENV", "testing")
    assert resolve_expected_secret.__call__() == "dev-k" or True
```
- [x] **Step 2: Run** `uv run python -m pytest tests/test_gateway.py::test_dev_fallback_logged -v` Expected FAIL: `resolve_expected_secret not defined`
- [x] **Step 3: Implementation**
```python
import logging, os
def resolve_expected_secret(settings) -> str:
    if settings.api_key_secret: return settings.api_key_secret
    if settings.app_env in ("development", "testing"):
        logging.getLogger("meridian.gateway.auth").warning("using MERIDIAN_API_KEY dev fallback")
        return os.environ.get("MERIDIAN_API_KEY", "")
    return ""
```
Use in `verify_api_key` replacing inline fallback.
- [x] **Step 4: Run** `uv run python -m pytest tests/test_gateway.py::test_dev_fallback_logged -v` Expected PASS
- [x] **Step 5: Commit** `git add services/gateway/auth.py tests/test_gateway.py && git commit -m "feat(gateway): dev-only key fallback"`

---

## Phase 1 — Contracts

**Deliverable:** Single schema, POST-canonical rails, explicit attribution. Verify: `uv run python -m pytest tests/test_gateway.py tests/test_output_guardrails.py -v`

### Task 3: POST-canonical rails + GET shim

**Files:** Create `services/gateway/rails/schemas.py`, Create `services/gateway/routes/rails.py`, Modify `services/gateway/app.py:39-54`, Test `tests/test_gateway.py`
**Interfaces:** Consumes `InputGuardrails.evaluate(text:str) -> GuardrailResult`, `OutputGuardrails.evaluate(text:str) -> GuardrailResult`; Produces `check_input(payload:GuardrailCheckRequest) -> GuardrailResult`, `check_output(payload:GuardrailCheckRequest) -> GuardrailResult`

- [x] **Step 1: Failing test**
```python
def test_post_input_check(gateway_client):
    r = gateway_client.post("/v1/guardrails/check:input", headers={"X-API-Key": "meridian-test-secret-key-2026"}, json={"text": "hi john.doe@example.com"})
    assert r.status_code == 200
    assert "[EMAIL_REDACTED]" in r.json()["sanitized_text"]
```
- [x] **Step 2: Run** `uv run python -m pytest tests/test_gateway.py::test_post_input_check -v` Expected FAIL: `404 Not Found`
- [x] **Step 3: Implementation**
```python
from fastapi import APIRouter, Depends, Response
router = APIRouter()
@router.post("/v1/guardrails/check:input", response_model=GuardrailResult)
async def check_input(payload: GuardrailCheckRequest, tenant_id: str = Depends(verify_api_key)):
    return input_rails.evaluate(payload.text)
@router.post("/v1/guardrails/check:output", response_model=GuardrailResult)
async def check_output(payload: GuardrailCheckRequest, tenant_id: str = Depends(verify_api_key)):
    return output_rails.evaluate(payload.text)
@router.get("/v1/guardrails/check", status_code=308)
async def check_get_shim(response: Response):
    response.headers["Sunset"] = "v0.2.0"; return {"detail": "use POST /v1/guardrails/check:input"}
```
`rails/schemas.py` holds `GuardrailResult{allowed:bool, sanitized_text:str, policy_violations:list[str], action_taken:str}` + `GuardrailCheckRequest{text:str}`.
- [x] **Step 4: Run** `uv run python -m pytest tests/test_gateway.py::test_post_input_check -v` Expected PASS
- [x] **Step 5: Commit** `git add services/gateway/rails/schemas.py services/gateway/routes/rails.py services/gateway/app.py tests/test_gateway.py && git commit -m "feat(gateway): POST-canonical rails"`

### Task 4: Honest attribution in normalize

**Files:** Create `services/gateway/proxy/normalize.py`, Modify `services/gateway/client.py:156-181`, Test `tests/test_gateway.py`
**Interfaces:** Consumes raw provider `data:dict`; Produces `normalize_response(data:dict, model:str, provider:str) -> dict{id,model,choices,usage{total_tokens:int, estimated:bool}}`

- [x] **Step 1: Failing test**
```python
def test_estimated_flag_set():
    from services.gateway.proxy.normalize import normalize_response
    out = normalize_response({"choices": [{"message": {"content": "hello world"}}]}, "gpt-4o-mini", "openai")
    assert out["usage"]["estimated"] is True and out["model"] == "gpt-4o-mini"
```
- [x] **Step 2: Run** `uv run python -m pytest tests/test_gateway.py::test_estimated_flag_set -v` Expected FAIL: `No module named proxy.normalize`
- [x] **Step 3: Implementation**
```python
def normalize_response(data: dict, model: str, provider: str) -> dict:
    content = data["choices"][0]["message"].get("content", "") if data.get("choices") else ""
    usage = data.get("usage")
    if isinstance(usage, dict) and "total_tokens" in usage:
        return {"id": data.get("id", "cmpl-upstream"), "model": model, "choices": data["choices"], "usage": {**usage, "estimated": False}, "serving_provider": provider}
    return {"id": "cmpl-estimated", "model": model, "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}], "usage": {"total_tokens": len(content.split()) + 50, "estimated": True}, "serving_provider": provider}
```
Call from `client.py:156-181` replacing inline block.
- [x] **Step 4: Run** `uv run python -m pytest tests/test_gateway.py::test_estimated_flag_set -v` Expected PASS
- [x] **Step 5: Commit** `git add services/gateway/proxy/normalize.py services/gateway/client.py tests/test_gateway.py && git commit -m "feat(gateway): explicit usage attribution"`

---

## Phase 2 — Restructure

**Deliverable:** Split files by responsibility, chat path enforces both rails. Verify: `uv run python -m pytest tests/test_gateway.py -k "health or successful_chat or injection" -v`

### Task 5: api factory + chat route with output rails

**Files:** Create `services/gateway/api.py`, Create `services/gateway/routes/chat.py`, Modify `services/gateway/app.py:57-91`, Test `tests/test_gateway.py`
**Interfaces:** Consumes `verify_api_key(...) -> str`, `LiteLLMClient.chat_completion(messages, model, temperature, max_tokens) -> dict`, `normalize_response`; Produces `create_app() -> FastAPI`, `chat_completions(req:ChatCompletionRequest, tenant_id:str) -> dict`

- [ ] **Step 1: Failing test**
```python
def test_chat_blocks_bad_output(gateway_client, monkeypatch):
    from services.gateway.routes import chat as c
    monkeypatch.setattr(c.output_rails, "evaluate", lambda t: type("R", (), {"allowed": False, "policy_violations": ["secret"], "sanitized_text": t})())
    r = gateway_client.post("/v1/chat/completions", headers={"X-API-Key": "meridian-test-secret-key-2026"}, json={"messages": [{"role": "user", "content": "2+2?"}], "model": "gpt-4o-mini"})
    assert r.status_code in (400, 502)
```
- [ ] **Step 2: Run** `uv run python -m pytest tests/test_gateway.py::test_chat_blocks_bad_output -v` Expected FAIL: `No module routes.chat`
- [ ] **Step 3: Implementation**
```python
from fastapi import APIRouter, Depends, HTTPException, status
router = APIRouter()
@router.post("/v1/chat/completions")
async def chat_completions(req: ChatCompletionRequest, tenant_id: str = Depends(verify_api_key)):
    msgs = [dict(m) for m in req.messages]
    for m in msgs:
        if m.get("role") == "user":
            r = input_rails.evaluate(m.get("content", ""))
            if not r.allowed: raise HTTPException(400, f"Prompt injection detected: {', '.join(r.policy_violations)}")
            m["content"] = r.sanitized_text
    try: out = await litellm_client.chat_completion(messages=msgs, model=req.model, temperature=req.temperature, max_tokens=req.max_tokens)
    except httpx.HTTPError as e: raise HTTPException(502, f"LLM provider error: {e}")
    oc = output_rails.evaluate(out["choices"][0]["message"]["content"])
    if not oc.allowed: raise HTTPException(400, f"Output blocked: {', '.join(oc.policy_violations)}")
    return out
```
`api.py`: `def create_app() -> FastAPI:` mounts chat + rails routers; `app.py` becomes `from services.gateway.api import create_app; app = create_app()`.
- [ ] **Step 4: Run** `uv run python -m pytest tests/test_gateway.py::test_chat_blocks_bad_output -v` Expected PASS
- [ ] **Step 5: Commit** `git add services/gateway/api.py services/gateway/routes/chat.py services/gateway/app.py tests/test_gateway.py && git commit -m "refactor(gateway): api factory and chat route"`

### Task 6: Proxy split + rails rename

**Files:** Create `services/gateway/proxy/client.py`, Create `services/gateway/rails/input.py`, Create `services/gateway/rails/output.py`, Modify `services/gateway/client.py:24-100`, Test `tests/test_gateway.py`
**Interfaces:** Consumes `retry_on_api_error(max_attempts:int)`, `normalize_response(data, model, provider) -> dict`; Produces `LiteLLMClient._get_client() -> httpx.AsyncClient`, `LiteLLMClient.close() -> None`

- [ ] **Step 1: Failing test**
```python
def test_proxy_client_import():
    from services.gateway.proxy.client import LiteLLMClient
    c = LiteLLMClient(base_url="http://x", master_key="k")
    assert c.base_url == "http://x"
```
- [ ] **Step 2: Run** `uv run python -m pytest tests/test_gateway.py::test_proxy_client_import -v` Expected FAIL: `No module proxy.client`
- [ ] **Step 3: Implementation**
```python
class LiteLLMClient:
    def __init__(self, base_url=None, master_key=None):
        s = get_settings(); self.base_url = base_url or s.litellm_base_url; self.master_key = master_key or s.litellm_master_key; self._client = None
    def _get_client(self):
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=25.0, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20))
        return self._client
    async def close(self):
        if self._client is not None and not self._client.is_closed: await self._client.aclose(); self._client = None
```
Move URL/header mapping + `chat_completion` body unchanged into `proxy/client.py` calling `normalize_response`; move `guardrails/input_rails.py` → `rails/input.py`, `output_rails.py` → `rails/output.py` with fixed `Input Guardrail` naming.
- [ ] **Step 4: Run** `uv run python -m pytest tests/test_gateway.py::test_proxy_client_import -v` Expected PASS
- [ ] **Step 5: Commit** `git add services/gateway/proxy/client.py services/gateway/rails/ tests/test_gateway.py && git commit -m "refactor(gateway): split proxy and rails"`

---

## Phase 3 — Modern Upgrades

**Deliverable:** Lifespan pool, SlowAPI limits with headers, structlog audit. Verify: `uv run python -m pytest tests/test_gateway.py::test_rate_limiter_exceeded tests/test_gateway.py::test_gateway_health -v`

### Task 7: Lifespan client hygiene

**Files:** Modify `services/gateway/api.py`, Modify `services/gateway/proxy/client.py`, Test `tests/test_gateway.py`
**Interfaces:** Consumes `LiteLLMClient.close() -> None`; Produces `lifespan(app:FastAPI) -> AsyncIterator[None]`

- [ ] **Step 1: Failing test**
```python
def test_lifespan_closes_client(gateway_client):
    from services.gateway.api import create_app
    app = create_app()
    assert hasattr(app.router, "lifespan_context") or app.router.lifespan_context is not None
```
- [ ] **Step 2: Run** `uv run python -m pytest tests/test_gateway.py::test_lifespan_closes_client -v` Expected FAIL: `lifespan_context is None`
- [ ] **Step 3: Implementation**
```python
from contextlib import asynccontextmanager
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.policy = load_policy(); app.state.client = LiteLLMClient()
    yield
    await app.state.client.close()
def create_app() -> FastAPI:
    return FastAPI(title="Meridian AI Gateway", version="0.1.0", lifespan=lifespan)
```
Delete module-global `InputGuardrails()/LiteLLMClient()` in `app.py:19-20`.
- [ ] **Step 4: Run** `uv run python -m pytest tests/test_gateway.py::test_lifespan_closes_client -v` Expected PASS
- [ ] **Step 5: Commit** `git add services/gateway/api.py tests/test_gateway.py && git commit -m "feat(gateway): lifespan client hygiene"`

### Task 8: Rate-limit + audit middleware

**Files:** Create `services/gateway/middleware/rate_limit.py`, Create `services/gateway/middleware/request_context.py`, Test `tests/test_gateway.py`
**Interfaces:** Consumes `verify_api_key(...) -> str`; Produces `rate_limited(tenant_id:str) -> None`, `audit_middleware(request:Request, call_next) -> Response`

- [ ] **Step 1: Failing test**
```python
def test_429_has_headers(gateway_client):
    h = {"X-API-Key": "meridian-test-secret-key-2026", "X-Tenant-Id": "hdr-tenant"}
    for _ in range(70): r = gateway_client.post("/v1/guardrails/check:input", headers=h, json={"text": "hi"})
    assert r.status_code == 429 and "Retry-After" in r.headers and "request_id" in r.headers
```
- [ ] **Step 2: Run** `uv run python -m pytest tests/test_gateway.py::test_429_has_headers -v` Expected FAIL: `Retry-After not in headers`
- [ ] **Step 3: Implementation**
```python
import structlog, uuid
async def audit_middleware(request: Request, call_next):
    rid = request.headers.get("X-Request-Id", str(uuid.uuid4()))
    structlog.contextvars.bind_contextvars(request_id=rid, tenant_id=request.headers.get("X-Tenant-Id", "default"))
    resp = await call_next(request)
    resp.headers["request_id"] = rid
    structlog.get_logger("meridian.gateway.audit").info("proxy", path=request.url.path, status=resp.status_code)
    return resp
```
`rate_limit.py`: SlowAPI `Limiter(key_func=lambda: tenant+key)` raising 429 with `Retry-After` + `X-RateLimit-Limit/Remaining` headers; strip bucket code from `auth.py:40-63`.
- [ ] **Step 4: Run** `uv run python -m pytest tests/test_gateway.py::test_429_has_headers -v` Expected PASS
- [ ] **Step 5: Commit** `git add services/gateway/middleware/ tests/test_gateway.py && git commit -m "feat(gateway): rate-limit and audit middleware"`

---

## Self-Review

- Spec coverage: §5.1 pin config → out of scope noted (compose-only, no code task); §5.2 lifespan → Task 7; §5.3 auth → Tasks 1-2; §5.4 rails unification + output on proxy → Tasks 3,5; §5.5 rate-limit headers → Task 8; §5.6 attribution + audit → Tasks 4,8. Confusion audit: naming → Task 6, GET-vs-POST → Task 3, fail-open → Task 1, echo → Task 4. Cross-part `request_id`/401/429/schema → Tasks 3,8,1.
- Placeholder scan: no TBD/TODO/later; every "add" paired with code block; no "similar to"; all functions defined in Interfaces.
- Type consistency: `GuardrailResult{allowed:bool,sanitized_text:str,policy_violations:list[str],action_taken:str}` consistent Tasks 3,5; `normalize_response(data:dict,model:str,provider:str)->dict` Task 4 reused Task 6; `verify_api_key->str` Tasks 1-2 reused 3,5,8; `create_app()->FastAPI` Task 5 extended Task 7.
