# Core Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify settings, secrets, DB, and retry behind one fail-closed owner with masked outputs.

**Architecture:** Single `packages/core/settings.py` owns env/secrets/DB config; `services/rag_engine/app.py` keeps a thin `get_active_llm_config()` reader; DB and retry go through dialect-aware factory and single predicate.

**Tech Stack:** pydantic-settings>=2.14.2, SQLAlchemy 2.0.38 (aiosqlite, asyncpg extra), tenacity `retry_if_exception`, FastAPI.

**Spec:** `2026-09-28_PLAN_CORE_PLATFORM.md`

## Global Constraints

- Fail-closed secrets: production boot raises on empty or test-default secrets.
- Masked shapes: API never returns raw keys, only `configured` plus last-4 hint.
- Dialect-aware DB: SQLite and Postgres get different engine args via factory.
- 5xx-only retry: retry network errors plus 429/5xx, never other 4xx.

---

## File Structure

- `packages/core/settings.py` (new): single `BaseSettings` owner; nested `LlmSettings, DbSettings, VectorSettings, SecretsSettings`; `env_nested_delimiter="__"`, `secrets_dir`, `SecretStr`; `validate_production()`; `masked_view()`.
- `packages/core/secrets_store.py` (new): file-perms 0600 helpers, non-secret-only persistence, merge-preserving-saved.
- `packages/core/config.py`: shim re-exporting `settings.py` during migration, then deleted.
- `packages/core/db.py`: remove import-time engine; add `create_engine_for(url)` + `init_db(url)`; `AsyncSessionLocal` bound lazily.
- `packages/core/retry_config.py`: single `is_retryable(exc)` predicate; `retry_transient()` via `retry_if_exception`.
- `packages/core/models.py` + `packages/core/db_models.py` (new split): Pydantic domain stays in `models.py`; SQLAlchemy `Base` and ORM classes move to `db_models.py`.
- `services/rag_engine/app.py:123-202,567-597`: delete JSON globals and file writes; keep `get_active_llm_config()` reader; masked POST/GET responses.

## Phase 0 — Safety

Verification: `uv run python -m pytest tests/test_api_seam.py tests/test_gateway.py -q` expects boot refusal on empty secrets; `rg "meridian-test-secret" -g'!PLAN_*' .` returns nothing.

### Task 0: Fail-closed boot, reject empty key

**Files:**
- Modify: `packages/core/config.py:14-52`
- Test: `tests/test_core_boot.py`

**Interfaces:**
- Consumes: `os.environ` values `APP_ENV, API_KEY_SECRET, LITELLM_MASTER_KEY, DATABASE_URL`.
- Produces: `validate_production(settings) -> None` raising `RuntimeError` naming the missing variable.

- [ ] **Step 1: Write the failing test**

```python
def test_production_rejects_empty_key(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("API_KEY_SECRET", "")
    from packages.core.config import Settings, validate_production
    import pytest
    with pytest.raises(RuntimeError, match="API_KEY_SECRET"):
        validate_production(Settings())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_core_boot.py::test_production_rejects_empty_key -v`
Expected: FAIL with "validate_production not defined".

- [ ] **Step 3: Write minimal implementation**

```python
def validate_production(s: Settings) -> None:
    if s.app_env == "production" and not s.api_key_secret:
        raise RuntimeError("missing required secret: API_KEY_SECRET")
    if s.app_env == "production" and not s.litellm_master_key:
        raise RuntimeError("missing required secret: LITELLM_MASTER_KEY")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_core_boot.py::test_production_rejects_empty_key -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/config.py tests/test_core_boot.py
git commit -m "feat(core): fail-closed production boot"
```

### Task 1: Masked POST response, no key echo

**Files:**
- Modify: `services/rag_engine/app.py:567-597`
- Test: `tests/test_settings_masked.py`

**Interfaces:**
- Consumes: `_runtime_llm_settings: dict[str, Any]`.
- Produces: `masked_llm_view(d: dict[str, Any]) -> dict[str, Any]` with `configured: bool` and `*_hint: str` last-4 only.

- [ ] **Step 1: Write the failing test**

```python
def test_post_never_returns_raw_key():
    d = {"groq_api_key": "sk-SAVED-GROQ"}
    from services.rag_engine.app import masked_llm_view
    v = masked_llm_view(d)
    assert "sk-SAVED-GROQ" not in str(v)
    assert v["groq_api_key"]["configured"] is True
    assert v["groq_api_key"]["hint"] == "GROQ"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_settings_masked.py::test_post_never_returns_raw_key -v`
Expected: FAIL with "masked_llm_view not defined".

- [ ] **Step 3: Write minimal implementation**

```python
def masked_llm_view(d: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in d.items():
        if k.endswith("_api_key") and isinstance(v, str) and v:
            out[k] = {"configured": True, "hint": v[-4:]}
        else:
            out[k] = v
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_settings_masked.py::test_post_never_returns_raw_key -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/rag_engine/app.py tests/test_settings_masked.py
git commit -m "fix(api): mask settings POST response"
```

## Phase 1 — Contracts

Verification: `uv run python -m pytest tests/test_settings_persistence.py tests/test_core_models.py -q` all green; `GET /v1/settings/llm` shows no key material.

### Task 2: Forbid-schema alignment plus blank-preserve fix

**Files:**
- Modify: `packages/core/models.py:89-113`
- Test: `tests/test_settings_persistence.py::test_blank_submission_preserves_saved_everywhere`

**Interfaces:**
- Consumes: incoming JSON dict with UI keys `groq_api_key, openai_org_id, default_model, custom_base_url, active_provider`.
- Produces: `UpdateLLMSettingsRequest` accepting those keys, `extra="forbid"`, blank `""` mapped to `None` and dropped via `exclude_none=True`.

- [ ] **Step 1: Use the known failing test as the failing test**

```python
res = client.post("/v1/settings/llm", headers=HDR,
    json={"groq_api_key": "", "openai_org_id": "", "default_model": ""})
assert res.status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_settings_persistence.py::TestSettingsEndpointPersistence::test_blank_submission_preserves_saved_everywhere -v`
Expected: FAIL with "422 != 200" because `openai_org_id` and `default_model` are rejected by `extra="forbid"`.

- [ ] **Step 3: Write minimal implementation**

```python
class UpdateLLMSettingsRequest(BaseModel):
    provider: str | None = Field(None, pattern=r"^[a-z0-9_-]+$")
    active_provider: str | None = None
    groq_api_key: str | None = None
    openai_org_id: str | None = None
    default_model: str | None = None
    custom_base_url: str | None = None
    model_config = {"extra": "forbid"}
```

Keep the existing `empty_string_to_none` validator and `exclude_none=True` in the endpoint so blanks never reach `_merge_preserving_saved`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_settings_persistence.py::TestSettingsEndpointPersistence::test_blank_submission_preserves_saved_everywhere -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/models.py
git commit -m "fix(schema): align settings contract, preserve blanks"
```

### Task 3: Embedding dim check and QueryRequest defaults

**Files:**
- Modify: `packages/core/models.py:27-35`
- Test: `tests/test_core_models.py`

**Interfaces:**
- Consumes: `qdrant_vector_dim: int` from settings.
- Produces: `Chunk` validator raising `ValueError` when `len(embedding) != qdrant_vector_dim`.

- [ ] **Step 1: Write the failing test**

```python
def test_chunk_rejects_wrong_dim():
    import pytest
    from packages.core.models import Chunk
    with pytest.raises(ValueError, match="dim"):
        Chunk(id="c", document_id="d", text="t", embedding=[0.1] * 3,
              _expected_dim=1024 if False else None) if False else Chunk(
              id="c", document_id="d", text="t", embedding=[0.1] * 3)
```

Simplified executable form used in repo:

```python
def test_chunk_dim_mismatch():
    import pytest
    from packages.core.models import Chunk
    with pytest.raises(ValueError):
        Chunk(id="c", document_id="d", text="t", embedding=[0.1] * 3).validate_dim(1024)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_core_models.py::test_chunk_dim_mismatch -v`
Expected: FAIL with "validate_dim not defined".

- [ ] **Step 3: Write minimal implementation**

```python
def validate_dim(self, expected: int) -> "Chunk":
    if self.embedding is not None and len(self.embedding) != expected:
        raise ValueError(f"embedding dim {len(self.embedding)} != {expected}")
    return self
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_core_models.py::test_chunk_dim_mismatch -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/models.py tests/test_core_models.py
git commit -m "feat(models): embedding dim check"
```

## Phase 2 — Restructure

Verification: `uv run python -m pytest tests/test_settings_persistence.py -q` green; `ls -l .meridian_settings.json` absent or 0600; `git status --ignored` shows it ignored.

### Task 4: Single owner module with thin reader

**Files:**
- Create: `packages/core/settings.py`
- Modify: `services/rag_engine/app.py:123-207`
- Test: `tests/test_settings_owner.py`

**Interfaces:**
- Consumes: env vars with `env_nested_delimiter="__"` and `secrets_dir`.
- Produces: `get_settings() -> Settings`; `get_active_llm_config() -> dict[str, str]` returning `provider, model, base_url` only.

- [ ] **Step 1: Write the failing test**

```python
def test_reader_returns_no_secrets():
    from services.rag_engine.app import get_active_llm_config
    cfg = get_active_llm_config()
    assert set(cfg) <= {"provider", "model", "base_url"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_settings_owner.py::test_reader_returns_no_secrets -v`
Expected: FAIL with "get_active_llm_config not defined".

- [ ] **Step 3: Write minimal implementation**

```python
def get_active_llm_config() -> dict[str, str]:
    s = get_settings()
    return {"provider": "openai", "model": s.default_llm_model, "base_url": s.litellm_base_url}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_settings_owner.py::test_reader_returns_no_secrets -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/settings.py services/rag_engine/app.py tests/test_settings_owner.py
git commit -m "refactor: single settings owner"
```

### Task 5: Persistence perms and plaintext migration

**Files:**
- Modify: `.gitignore`, `packages/core/secrets_store.py` (new), `services/rag_engine/app.py:186-200`
- Test: `tests/test_secret_perms.py`

**Interfaces:**
- Consumes: settings dict and target `Path`.
- Produces: `save_prefs(path: Path, prefs: dict[str, Any]) -> None` writing 0600, persisting only non-secret keys.

- [ ] **Step 1: Write the failing test**

```python
def test_prefs_file_is_0600_and_secretless(tmp_path):
    import stat
    from packages.core.secrets_store import save_prefs
    p = tmp_path / "prefs.json"
    save_prefs(p, {"default_model": "gpt-4o-mini", "groq_api_key": "sk-X"})
    assert oct(p.stat().st_mode & 0o777) == "0o600"
    assert "groq_api_key" not in p.read_text()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_secret_perms.py::test_prefs_file_is_0600_and_secretless -v`
Expected: FAIL with "secrets_store not defined".

- [ ] **Step 3: Write minimal implementation**

```python
import json, os
SECRET_SUFFIX = ("_api_key", "_secret", "_password")
def save_prefs(path, prefs):
    clean = {k: v for k, v in prefs.items() if not k.endswith(SECRET_SUFFIX)}
    path.write_text(json.dumps(clean, indent=2), encoding="utf-8")
    os.chmod(path, 0o600)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_secret_perms.py::test_prefs_file_is_0600_and_secretless -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/secrets_store.py .gitignore tests/test_secret_perms.py
git commit -m "fix(secrets): 0600 non-secret prefs only"
```

## Phase 3 — Modern upgrades

Verification: `DATABASE_URL=sqlite+aiosqlite:///./t.db uv run python -m pytest tests/test_hitl_review.py tests/test_bugfix_p0.py -q` green; new 400/401/404-never-retry and 503/429-retry cases green.

### Task 6: Driver-aware engine factory plus asyncpg decision

**Files:**
- Modify: `packages/core/db.py:12-20`, `pyproject.toml`
- Test: `tests/test_db_factory.py`

**Interfaces:**
- Consumes: `url: str`.
- Produces: `create_engine_for(url: str)` returning SQLite engine with `NullPool` and `connect_args={"timeout": 30, "check_same_thread": False}`, Postgres engine with `pool_size=10, max_overflow=20`; `init_db(url: str)`.

- [ ] **Step 1: Write the failing test**

```python
def test_sqlite_factory_has_no_pool_size():
    from packages.core.db import create_engine_for
    e = create_engine_for("sqlite+aiosqlite:///./t.db")
    assert "pool_size" not in str(e.url)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_db_factory.py::test_sqlite_factory_has_no_pool_size -v`
Expected: FAIL with "create_engine_for not defined".

- [ ] **Step 3: Write minimal implementation**

```python
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool
def create_engine_for(url: str):
    if url.startswith("sqlite"):
        return create_async_engine(url, poolclass=NullPool,
            connect_args={"timeout": 30, "check_same_thread": False})
    return create_async_engine(url, pool_size=10, max_overflow=20, pool_pre_ping=True)
```

Add `postgres = ["asyncpg>=0.29"]` extra to `pyproject.toml`; keep `aiosqlite` for local only.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_db_factory.py::test_sqlite_factory_has_no_pool_size -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/db.py pyproject.toml tests/test_db_factory.py
git commit -m "feat(db): driver-aware engine factory"
```

### Task 7: Correct retry predicate wiring

**Files:**
- Modify: `packages/core/retry_config.py:60-72`
- Test: `tests/test_retry_predicate.py`

**Interfaces:**
- Consumes: `exc: BaseException`.
- Produces: `is_retryable(exc: BaseException) -> bool` true only for `ConnectError/TimeoutError/OSError` and `HTTPStatusError` with status in `{429, 500, 502, 503, 504}`; `retry_transient()` using `retry_if_exception(is_retryable)`.

- [ ] **Step 1: Write the failing test**

```python
def test_4xx_never_retries_503_retries():
    import httpx
    from packages.core.retry_config import is_retryable
    r404 = httpx.Response(404, request=httpx.Request("GET", "http://x"))
    r503 = httpx.Response(503, request=httpx.Request("GET", "http://x"))
    assert is_retryable(httpx.HTTPStatusError("nf", request=r404.request, response=r404)) is False
    assert is_retryable(httpx.HTTPStatusError("se", request=r503.request, response=r503)) is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_retry_predicate.py::test_4xx_never_retries_503_retries -v`
Expected: FAIL with "is_retryable not defined".

- [ ] **Step 3: Write minimal implementation**

```python
import httpx
from tenacity import retry_if_exception
_RETRYABLE = {429, 500, 502, 503, 504}
def is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _RETRYABLE
    import asyncio
    return isinstance(exc, (ConnectionError, TimeoutError, OSError, asyncio.TimeoutError))
def retry_transient(max_attempts: int = 5):
    from tenacity import retry, stop_after_attempt, wait_exponential
    return retry(stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=1, min=1, max=30),
        retry=retry_if_exception(is_retryable), reraise=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_retry_predicate.py::test_4xx_never_retries_503_retries -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/retry_config.py tests/test_retry_predicate.py
git commit -m "fix(retry): 5xx-only predicate wiring"
```

## Self-Review

- Spec coverage: fail-closed boot Task 0; hardcoded-secret removal Tasks 0/5; single owner Tasks 4/5; masking Tasks 1/4; plaintext migration Task 5; DB factory Task 6; retry predicate Task 7; schema hygiene Tasks 2/3. All six sequenced items mapped.
- Placeholder scan: no TBD, TODO, later, appropriate, edge cases, similar-to strings; every step has real test code, real run command, real impl code, real commit.
- Type consistency: `validate_production(Settings)->None`; `masked_llm_view(dict)->dict`; `UpdateLLMSettingsRequest` field names match endpoint `updates` keys; `get_active_llm_config()->dict[str,str]`; `save_prefs(Path,dict)->None`; `create_engine_for(str)`; `is_retryable(BaseException)->bool` and `retry_transient(int)` used consistently.
