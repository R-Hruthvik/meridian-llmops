# Core Platform Improvement Plan — Meridian LLMOps

Goal: single owner for settings/config/secrets/DB/retry with fail-closed boot and masked outputs.

## 1. Current state

- `packages/core/config.py:38,51`: flat `Settings(BaseSettings)` holds secrets as plain `str` with `os.environ.get(..., "")` defaults; `database_url` defaults to `sqlite+aiosqlite:///./verified_rag.db`, no dialect branching or prod guard.
- `packages/core/db.py:12-20`: module-level `create_async_engine` passes Postgres-style `pool_size=10, max_overflow=20, pool_timeout, pool_recycle` unconditionally, which SQLite/aiosqlite ignores or rejects; engine is created at import time from a cached singleton.
- `packages/core/models.py:35,89-123`: `Chunk.embedding: list[float] | None` has no dim check against `qdrant_vector_dim=1024`; `UpdateLLMSettingsRequest` exposes seven parallel `*_api_key` plain-string fields with `extra="forbid"` while `QueryRequest/QueryResponse` carry overlapping `max_cycles/enforce_guardrails` defaults owned elsewhere.
- `packages/core/retry_config.py:60-72`: `_is_retryable_exception` correctly limits `httpx.HTTPStatusError` to 5xx but is never wired in; the live `retry=` clause uses `retry_if_exception_type(...) | retry_if_exception_type(httpx.HTTPStatusError)` and therefore retries every 4xx including 400/401/404.
- `services/rag_engine/app.py:123-202,567-597` + `.meridian_settings.json` + `start.sh:72` + `Dockerfile:20` + `pyproject`: second settings system (JSON file with module globals, masked-merge helpers, `asyncio.Lock`) persists live API keys in plaintext at repo root; shell/Docker inject `meridian-test-secret-key-2026` / `sk-litellm-master-key` as defaults; `pyproject` pins `sqlalchemy>=2.0.28, aiosqlite` with no `asyncpg`.

## 2. Confusion audit

- Two owners, two truths: `packages/core/config.py` (env/`.env`) vs `services/rag_engine/app.py` runtime JSON dict means an operator cannot tell which value wins; `extra="ignore"` in core vs `extra="forbid"` in `UpdateLLMSettingsRequest` causes silent drift where a renamed key is dropped in one layer and rejected in the other.
- Secret leak path: persisted JSON stores `custom_api_key` in cleartext (observed live key in repo file), `GET /v1/settings/llm`-style reads and `POST` echo return full maps, and masking (`...` / `***`) lives only in the merge helper rather than the schema, so one missed call site leaks.
- SQLite crash path: Postgres pool kwargs on an aiosqlite engine plus import-time engine creation means `DATABASE_URL` swaps at runtime have no effect and file-DB defaults to `AsyncAdaptedQueuePool` semantics the code never configures (https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html, http://docs.sqlalchemy.org/en/latest/dialects/sqlite.html); concurrent writes hit `database is locked` with no WAL/timeout story.
- 4xx retry storm: dead predicate means auth/validation errors (401/404/429 without `Retry-After`) are retried with exponential backoff, amplifying outages and burning LLM budgets; correct pattern is a single `retry_if_exception` predicate returning true only for network errors plus 5xx/429 (https://github.com/jd/tenacity/blob/main/tenacity/retry.py, https://techoral.com/python/tenacity-retry.html, https://tenacity.readthedocs.io/en/stable/api.html).
- Fail-open secrets: empty-string defaults for `api_key_secret/neo4j_password/litellm_master_key` plus hardcoded test secrets in `start.sh/Dockerfile` let dev, CI, and prod all boot with the same credential; no required-in-prod check, no file-permission check, no encryption, unlike `secrets_dir` + nested-delimiter practice (https://pydantic.dev/docs/validation/2.11/concepts/pydantic_settings/).

## 3. Simplified restructure

- Single owner `packages/core/settings.py`: one `BaseSettings` with nested models (`LlmSettings, DbSettings, VectorSettings, SecretsSettings`), `env_nested_delimiter="__"`, `secrets_dir` support, `SecretStr` for all keys, computed masked view for API responses; `services/rag_engine/app.py` keeps only a thin `get_active_llm_config()` reader, no file writes, no globals (https://pydantic.dev/docs/validation/2.10/concepts/pydantic_settings/).
- Fail-closed boot: `app_env=production` requires non-empty `API_KEY_SECRET`, `LITELLM_MASTER_KEY`, and real `DATABASE_URL`; raise at startup with a named missing-variable error; dev/test keep explicit opt-in defaults only; remove `ENV API_KEY_SECRET=...` from `Dockerfile`, make `start.sh` warn and generate an ephemeral value when unset rather than exporting a shared one.
- Secrets at rest: delete `.meridian_settings.json` from repo, gitignore the path, chmod 0600 when created, migrate to env/dotenv or Docker/K8s secrets; API shapes never return secrets, only `configured: bool` plus last-4 hint; persist only non-secret preferences (model names, base URLs).
- Driver-aware DB init: replace import-time engine with `create_engine_for(url)` factory — SQLite gets `NullPool` or queue pool + `connect_args={"timeout":30,"check_same_thread":False}` and WAL pragma, Postgres gets `asyncpg` pool args; `init_db()` takes an explicit URL; add `asyncpg` extra to `pyproject`.
- Retry fix: delete dead predicate, replace with one `is_retryable(exc)` used via `retry_if_exception`: true for `ConnectError/TimeoutError/OSError` and `HTTPStatusError` with status in `{429,500,502,503,504}` honoring `Retry-After` where present; never retry other 4xx.
- Merge/split/delete: merge `config.py` + app JSON helpers into `settings.py` + `secrets_store.py`; split ORM Base/models out of `models.py` into `db_models.py`; delete `retry_on_connection_failure` duplicate in favor of parameterized `retry_transient()`; delete test-secret defaults. Non-goals: no Vault/KMS integration, no multi-tenant secrets isolation, no embedding-model migration, no gateway auth redesign.

## 4. Modern-tool upgrades

| Tool | Current | 2026 latest (fetched) | Adopt/skip + why |
|---|---|---|---|
| pydantic-settings | `>=2.2.0`, flat, `extra="ignore"` | v2.15.0 / v2.14.2 hardened (https://pypi.org/project/pydantic-settings/, https://github.com/pydantic/pydantic-settings/security/advisories/GHSA-4xgf-cpjx-pc3j) | Adopt `>=2.14.2`: nested delimiter, `secrets_dir`, `SecretStr`, symlink-safe loader. |
| SQLAlchemy async | `>=2.0.28`, one-size pool args | 2.0.38+ / 2.1.0b3, per-dialect pools (https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html, http://docs.sqlalchemy.org/en/latest/dialects/sqlite.html) | Adopt factory + `asyncpg` extra; keep `aiosqlite` for local only. |
| tenacity | `>=8.2.0`, dead predicate + broad type retry | `retry_if_exception(predicate)` pattern (https://tenacity.readthedocs.io/en/stable/api.html, https://techoral.com/python/tenacity-retry.html) | Adopt single predicate + `wait_exponential_jitter` + 429 handling. |
| Secrets mgmt | plaintext JSON 0600-ignored, shell defaults | env + `secrets_dir`, 0600 perms, orchestrator mounts | Adopt env/file-perms now; skip Vault/KMS in this cycle. |
| asyncpg driver | absent | current Postgres async standard via `postgresql+asyncpg://` | Adopt as optional `postgres` extra; skip pgvector/server-side cursors here. |

## 5. Sequenced improvement plan

1. Fail-closed boot + remove hardcoded secrets — touch `start.sh, Dockerfile, packages/core/config.py`; verify `API_KEY_SECRET= uv run python -m pytest tests/test_api_seam.py tests/test_gateway.py -q` expects boot refusal, and `rg "meridian-test-secret" -g'!PLAN_*' .` returns nothing.
2. Single settings owner with masking — touch `packages/core/settings.py` (new), `services/rag_engine/app.py:123-202,567-597`; verify `uv run python -m pytest tests/test_settings_persistence.py tests/test_core_models.py -q` and manual `GET /v1/settings/llm` shows no key material.
3. Plaintext migration + ignore — touch `.gitignore, services/rag_engine/app.py, docs/runbook`; verify `uv run python -m pytest tests/test_settings_persistence.py -q` plus `ls -l .meridian_settings.json` shows absent or 0600 and `git status --ignored` lists it ignored.
4. Driver-aware DB factory + `asyncpg` extra — touch `packages/core/db.py, pyproject.toml`; verify `uv run python -m pytest tests/test_hitl_review.py tests/test_bugfix_p0.py -q` under both `DATABASE_URL=sqlite+aiosqlite:///./t.db` and a Postgres URL when available.
5. Retry predicate fix + 4xx no-retry tests — touch `packages/core/retry_config.py`; verify `uv run python -m pytest tests/test_observability.py tests/test_agent_graph.py -q` and new 400/401/404-never-retry vs 503/429-retry cases pass.
6. Schema hygiene (embedding dim, key consolidation, response masks) — touch `packages/core/models.py, packages/core/db_models.py` (new split); verify `uv run python -m pytest tests/test_core_models.py tests/test_retrieval.py tests/test_ingestion.py -q` plus `uv run ruff check packages/core services/rag_engine` clean.

## Cross-part note

- Settings contract: siblings read via `get_settings()` / `get_active_llm_config()` only, never the JSON file directly.
- DB contract: pass `DATABASE_URL` into `create_engine_for()`; SQLite local-only, Postgres via `asyncpg` in staging/prod.
- Retry contract: use `retry_transient()`; 4xx never retried except 429 with backoff.
- Secrets contract: API returns `configured` flags, never raw keys; non-secret prefs only on disk.
- Boot contract: production refuses to start with empty or test-default secrets.
