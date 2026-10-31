# AI Gateway Improvement Plan — Meridian LLMOps

## 1. Current state

- `services/gateway/app.py:39-45` exposes `GET /v1/guardrails/check?text=` returning `GuardrailResult`, and `app.py:48-54` keeps a hidden `POST` alias that evaluates the same `InputGuardrails.evaluate()` path.
- `services/gateway/app.py:57-91` proxies `POST /v1/chat/completions` through input-rail screening on user messages then `LiteLLMClient.chat_completion()`; only `httpx.HTTPError` maps to 502, output rails never run on this path.
- `services/gateway/auth.py:22-38` implements `verify_api_key` (`X-API-Key` + `X-Tenant-Id`) with fail-fast 401 when no secret is configured, except a dev/testing `MERIDIAN_API_KEY` fallback at `auth.py:30-34`.
- `services/gateway/auth.py:40-63` adds in-process per-tenant token-bucket rate limiting (asyncio lock, 5-min TTL eviction); `services/gateway/client.py:24-31` shares one pooled `httpx.AsyncClient` with lazy init and `close()`.
- `services/gateway/client.py:110-181` normalizes SSE vs JSON vs Anthropic/Ollama shapes into one OpenAI-style envelope with estimated `usage` fallback, `client.py:182-198` raises `HTTPStatusError` on non-200, retried via `packages/core/retry_config.py:42-73` (`retry_on_api_error`, 5 attempts); `guardrails/input_rails.py:57-73` blocks injections, redacts PII, while `guardrails/output_rails.py:22-44` blocks prohibited phrases — wired nowhere in `app.py`.

## 2. Confusion audit

- **Naming drift vs CONTEXT.md:** code says `LiteLLMClient`, "prompt sanitizer"-style `sanitized_text` mutation, and "pre-filter" comments, while `CONTEXT.md:9-19` mandates AI Gateway / Input Guardrail / Output Guardrail terms; newcomers cannot tell proxy from rails ownership.
- **GET-vs-POST rails:** two routes do the same check; GET leaks PII/prompt text into logs and URL length limits, POST is marked deprecated yet is the only pattern tests use (`tests/test_gateway.py:48-58`). No output-rail check endpoint exists despite `output_rails.py` + `policy.yaml` + `schema_validator.py` shipping.
- **Auth fail-open reading:** the empty-secret comment plus env fallback looks fail-open on skim; actual prod behavior is fail-closed 401, but there is no startup assertion, no `429` `Retry-After` header, and limits live in process memory so replicas diverge.
- **Model-attribution echo:** `client.py:169-180` echoes the requested `model` back as serving model and synthesizes `cmpl-response` ids plus estimated token counts, so callers cannot distinguish real upstream usage from guesses; `QueryResponse.serving_provider/serving_model` downstream then carries fiction.
- **Rate-limit claims:** `app.py:13-17` advertises "Rate Limiting" with no headers, no per-model/key budgets, and no LiteLLM-native budgets; meanwhile `docker-compose.yml:38` pins `ghcr.io/berriai/litellm:main-v1.35.8` rolling tag and `litellm_config.yaml:1-25` hardcodes `host.docker.internal` omniroute routing, hiding where policy actually enforces.

## 3. Simplified restructure

Proposed `services/gateway/` (single responsibility per file):

- `api.py` — FastAPI factory + `lifespan` only; mounts routers, middleware; no business logic.
- `routes/chat.py` — `POST /v1/chat/completions`: auth dep → input rails → proxy → output rails → audited response.
- `routes/rails.py` — `POST /v1/guardrails/check:input` and `POST /v1/guardrails/check:output`; delete `GET ?text=` after one-release shim (return 308 with sunset header).
- `auth.py` — secret load + `verify_api_key` dep only; move bucket to `middleware/rate_limit.py`.
- `middleware/request_context.py` — request-id, tenant bind, structlog context, audit log write (no PII bodies by default).
- `proxy/client.py` — transport + provider URL/header mapping only; move SSE/JSON normalization to `proxy/normalize.py` with explicit `estimated: true` flag.
- `rails/input.py`, `rails/output.py`, `rails/schema.py` — rename from `guardrails/`; `policy.yaml` becomes the single allow/block/redact source both import.

Merge: fold `ChatCompletionRequest`/`GuardrailCheckRequest` into `rails/schemas.py`; fold retry usage into client only. Split: auth vs rate limit vs audit logging (currently tangled in one dep). Delete: GET check route, hidden `include_in_schema=False` alias, manual `msg["content"]` mutation in handler.

Non-goals (YAGNI): no custom billing/metering service, no multi-region failover, no LLM-based injection classifier, no admin UI for keys, no WebSocket/streaming support in this round.

## 4. Modern-tool upgrades

| Tool | Current | 2026 latest (fetched) | Adopt/skip + why |
|---|---|---|---|
| LiteLLM proxy | `main-v1.35.8` rolling pin, local regex rails | `v1.102.0` stable track; `pre_call`/`post_call`/`during_call` gateway guardrails, Presidio/Lakera/Aporia + `default_on` (https://docs.litellm.ai/docs/proxy/guardrails/quick_start) (https://docs.litellm.ai/release_notes/) | Adopt: pin `1.102.x-stable`, move PII/injection to native `guardrails:` with `default_on: true`; keep local regex only as offline fallback |
| FastAPI lifecycle | Module-global `InputGuardrails()`/`LiteLLMClient()` in `app.py:19-20`, no lifespan | `lifespan` context manager is recommended; `on_event` deprecated (https://fastapi.tiangolo.com/advanced/events/) | Adopt: `lifespan` owns client pool + policy load + `close()`; fixes leak on reload |
| Rate limiting | Hand-rolled in-memory token bucket | SlowAPI `Limiter` + `SlowAPIMiddleware`/`SlowAPIASGIMiddleware` with Redis/memory backends, per-route decorators (https://slowapi.readthedocs.io/en/stable/) | Adopt: SlowAPI keyed on tenant+key, Redis backend when configured; keeps in-memory only for single-replica dev |
| Audit logging | `logger.error` strings, no request ids | `structlog` `bind_contextvars`/`merge_contextvars` per-request JSON (https://python-observability.com/modern-python-logging-libraries-deep-dive/structlog-vs-loguru-vs-stdlib-logging/choosing-a-logging-library-for-fastapi/); `fastapi-audit`/`auditlog-fastapi` middleware with redaction + lifespan (https://pypi.org/project/fastapi-audit/) | Adopt structlog middleware first; skip DB-backed audit tables until retention requirement lands |

## 5. Sequenced improvement plan

1. **Pin + split config.** Touch `docker-compose.yml`, `services/gateway/litellm_config.yaml`. Verify `docker compose config` + `uv run pytest tests/test_gateway.py::test_gateway_health`. Outcome: reproducible LiteLLM image, omniroute base URL via env, no rolling-tag drift.
2. **Lifespan + client hygiene.** Touch `services/gateway/api.py` (new), `app.py`, `proxy/client.py`. Verify `uv run ruff check services/gateway` + `uv run pytest tests/test_gateway.py -k "health or successful_chat"`. Outcome: pooled client opened/closed once, no global leaks.
3. **Auth hardening.** Touch `services/gateway/auth.py`, `packages/core/config.py`. Verify `uv run pytest tests/test_gateway.py -k auth` + manual 401 with empty secret. Outcome: startup assertion on missing secret, single header contract, fallback dev-only and logged.
4. **Rails unification.** Touch `routes/rails.py`, `rails/input.py`, `rails/output.py`, `rails/schema.py`, `policy.yaml`. Verify `uv run pytest tests/test_gateway.py tests/test_output_guardrails.py`. Outcome: POST-only input/output check, output rails enforced on proxy path, policy single-sourced.
5. **Rate-limit middleware.** Touch `middleware/rate_limit.py`, `api.py`. Verify `uv run pytest tests/test_gateway.py::test_rate_limiter_exceeded` + header assertion on 429. Outcome: per-tenant limits with `X-RateLimit-*`/`Retry-After`, Redis-ready.
6. **Attribution + audit.** Touch `proxy/normalize.py`, `middleware/request_context.py`. Verify `uv run pytest tests/test_api_seam.py` + log grep for `request_id tenant_id model provider estimated`. Outcome: no fabricated usage, every proxy decision traceable without PII in URLs.

## Cross-part note

- Auth contract siblings use: `X-API-Key` required, `X-Tenant-Id` optional default `default`; 401 invalid key, 429 with `Retry-After`.
- Rails schema siblings use: single `GuardrailResult{allowed,sanitized_text,policy_violations,action_taken}` for both input and output checks.
- Proxy attribution siblings read: `model, serving_provider, usage{total_tokens, estimated:bool}` never fabricated silently.
- RAG/orchestration calls only `POST /v1/chat/completions` and `POST /v1/guardrails/check:{input,output}`; GET check removed.
- Gateway emits `request_id` response header and JSON audit lines every sibling can correlate on.
