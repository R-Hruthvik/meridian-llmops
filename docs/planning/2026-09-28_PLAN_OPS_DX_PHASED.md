# Ops Evals DX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fail-closed secrets, health-gated boot, and blocking pytest plus DeepEval golden-set gate.

**Architecture:** Secrets and boot first, then one blocking eval gate with status surface, then staged upgrades behind green gates.

**Tech Stack:** Bash, Compose, FastAPI, Pydantic Settings, pytest, DeepEval 4.x `assert_test`, Qdrant, Neo4j, LiteLLM, Langfuse.

**Spec:** `2026-09-28_PLAN_OPS_DX.md`

## Global Constraints

- Fail closed on secrets: dev mints one ephemeral secret, prod never defaults.
- No green URLs until `/health/ready` 200 after `up --wait`.
- Opt-in seeding only: clean boot; `scripts/seed_demo.py --tenant demo` is the sole writer.
- Pytest plus DeepEval golden-set gate both block merges.

---

## File Structure

- `docker-compose.yml`: image pins, per-service `healthcheck`, `depends_on: service_healthy`, no empty secret defaults.
- `Dockerfile`: Node 22 pin, no baked secrets, `uv sync --frozen` build.
- `start.sh`: only entrypoint; secret validation, `up --wait`, readiness poll.
- `.github/workflows/ci.yml`: `uv sync --frozen`; blocking pytest and deepeval jobs.
- `packages/core/config.py`: `Settings` required-secret validation.
- `services/rag_engine/app.py`: owns `/health`, `/health/ready`, `/v1/eval/status`; logs `storage=`/`graph=`.
- `scripts/seed_demo.py` (new): only demo writer, `--tenant` required.
- `evals/test_deepeval_ci.py` + `evals/golden_dataset.json`: `assert_test` gate, Faithfulness >= 0.90, max one labeled stub.
- `docs/quickstart.md` + `docs/runbook.md` (new): boot/seed/query and env/health/fallback/logs/upgrade docs; slim README.

## Phase 0 — Safety

Verify: empty-secret boot exits non-zero; rg finds no baked keys; `uv run ruff check .` green.

### Task 1: Fail-closed required secrets

**Files:** Modify `start.sh`, `packages/core/config.py`, `.env.example`

**Interfaces:** Consumes `API_KEY_SECRET`, `LITELLM_MASTER_KEY`, `NEO4J_PASSWORD`, `POSTGRES_PASSWORD`. Produces non-zero exit printing `missing required secret: <NAME>`; prod `Settings` raises on empty secret.

- [x] **Step 1: Write the failing check**

```bash
API_KEY_SECRET= LITELLM_MASTER_KEY= ./start.sh --backend-only; test $? -ne 0
```

- [x] **Step 2: Run to verify it fails**

Run: `API_KEY_SECRET= LITELLM_MASTER_KEY= ./start.sh --backend-only; echo "exit=$?"`
Expected: FAIL — exits 0 on the hardcoded test key (`start.sh:72-74`).

- [x] **Step 3: Minimal implementation**

```bash
require_secret() { [ -n "$1" ] || { echo "missing required secret: $2" >&2; exit 1; }; }
require_secret "$API_KEY_SECRET" "API_KEY_SECRET"
require_secret "$LITELLM_MASTER_KEY" "LITELLM_MASTER_KEY"
```

Delete `:-fallback` defaults, mirror validation in `packages/core/config.py`, expand `.env.example`.

- [x] **Step 4: Run to verify it passes**

Run: `API_KEY_SECRET= LITELLM_MASTER_KEY= ./start.sh --backend-only; echo "exit=$?"`
Expected: PASS — non-zero exit naming the secret.

- [x] **Step 5: Commit**

```bash
git add start.sh packages/core/config.py .env.example
git commit -m "feat: fail-closed secrets"
```

### Task 2: Remove baked and browser-exposed test keys

**Files:** Modify `Dockerfile`, `start.sh`, `.github/workflows/ci.yml`, `tests/conftest.py`

**Interfaces:** Consumes CI-injected ephemeral `API_KEY_SECRET`, `MERIDIAN_API_KEY`. Produces no committed key in image or browser bundle; `.env` created with `600` perms.

- [x] **Step 1: Write the failing check**

```bash
rg -n "meridian-test-secret-key-2026|sk-litellm-master-key" Dockerfile start.sh; test $? -ne 0
```

- [x] **Step 2: Run to verify it fails**

Run: `rg -n "meridian-test-secret-key-2026|sk-litellm-master-key" Dockerfile start.sh`
Expected: FAIL — hits at `Dockerfile:20-21` and `start.sh:72-74` (`VITE_MERIDIAN_API_KEY`).

- [x] **Step 3: Minimal implementation**

```dockerfile
# Delete both baked ENV lines; runtime secrets arrive only via environment.
```

Delete the `VITE_` default export; `ci.yml` uses `openssl rand -hex 32`; fixed keys only in `tests/conftest.py`.

- [x] **Step 4: Run to verify it passes**

Run: `rg -n "meridian-test-secret-key-2026|sk-litellm-master-key" Dockerfile start.sh; echo "exit=$?"`
Expected: PASS — rg exits 1, no matches.

- [x] **Step 5: Commit**

```bash
git add Dockerfile start.sh .github/workflows/ci.yml tests/conftest.py
git commit -m "fix: drop baked secrets"
```

## Phase 1 — Boot contracts

Verify: `docker compose up --wait && curl -sf http://localhost:6333/healthz && curl -sf http://localhost:4000/health/readiness && curl -sf http://localhost:8000/health/ready`.

### Task 3: Health-gated compose and launcher

**Files:** Modify `docker-compose.yml`, `start.sh`

**Interfaces:** Consumes `http://localhost:6333/healthz`, `http://localhost:4000/health/readiness`, app `GET /health/ready`. Produces `./start.sh [--dev|--prod|--backend-only|--gateway-only] [--no-infra]`; Docker failure exits non-zero unless `--no-infra`; URLs print only after `/health/ready` 200.

- [x] **Step 1: Write the failing check**

```bash
docker compose config | rg -A 4 "langfuse:" | rg healthcheck
```

- [x] **Step 2: Run to verify it fails**

Run: `docker compose config | rg -A 4 "langfuse:" | rg healthcheck; echo "exit=$?"`
Expected: FAIL — `langfuse` has no healthcheck; `start.sh:44-55` continues silently on Docker failure.

- [x] **Step 3: Minimal implementation**

```yaml
langfuse:
  healthcheck:
    test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1"]
    interval: 10s
    timeout: 5s
    retries: 10
```

Add `depends_on: service_healthy` and `QDRANT_API_KEY`; `up -d` → `up --wait`; poll `/health/ready` before URLs.

- [x] **Step 4: Run to verify it passes**

Run: `docker compose up --wait && curl -sf http://localhost:6333/healthz && curl -sf http://localhost:4000/health/readiness`
Expected: PASS — all 200.

- [x] **Step 5: Commit**

```bash
git add docker-compose.yml start.sh
git commit -m "feat: health-gated boot"
```

### Task 4: Named backend plus opt-in seeding

**Files:** Modify `services/rag_engine/app.py`; create `scripts/seed_demo.py`

**Interfaces:** Consumes `Settings.database_url`, `qdrant_host`, `neo4j_uri`. Produces startup log `storage=<sqlite|postgres> graph=<memory|neo4j> vector=<memory|qdrant>`; `GET /health/ready` 200 with those keys; `uv run python scripts/seed_demo.py --tenant demo` ingests 3 fixture docs.

- [x] **Step 1: Write the failing test**

```python
def test_ready_names_backend():
    resp = client.get("/health/ready")
    assert resp.status_code == 200
    assert set(resp.json()) >= {"storage", "graph", "vector"}
```

- [x] **Step 2: Run to verify it fails**

Run: `uv run python -m pytest tests/test_api_seam.py -q -k ready`
Expected: FAIL — only `/health` exists (`app.py:303`); `/health/ready` is 404.

- [x] **Step 3: Minimal implementation**

```python
@app.get("/health/ready")
async def ready():
    s = get_settings()
    return {"storage": "sqlite" if "sqlite" in s.database_url else "postgres",
            "graph": "neo4j" if _graph_ok() else "memory",
            "vector": "qdrant" if _qdrant_ok() else "memory"}
```

Log the triple at startup; `seed_demo.py` requires `--tenant`, posts 3 fixture docs via `/v1/ingest`.

- [x] **Step 4: Run to verify it passes**

Run: `uv run python scripts/seed_demo.py --tenant demo && uv run python -m pytest tests/ -q`
Expected: PASS — 3 ingested ids; suite green.

- [x] **Step 5: Commit**

```bash
git add services/rag_engine/app.py scripts/seed_demo.py
git commit -m "feat: named readiness plus seeding"
```

## Phase 2 — Eval gate

Verify: `uv run python -m pytest tests/ -q && uv run deepeval test run evals/ && curl -sf http://localhost:8000/v1/eval/status`.

### Task 5: Zero baseline and single pytest gate

**Files:** Modify `tests/test_bugfix_p0.py`, `pyproject.toml`, `.github/workflows/ci.yml`

**Interfaces:** Consumes `API_KEY_SECRET`, `APP_ENV=testing`. Produces `uv run python -m pytest tests/ -q` with 77 passed; CI installs via `uv sync --frozen`.

- [x] **Step 1: Write the failing check**

```bash
uv run python -m pytest tests/test_bugfix_p0.py::test_blank_submission_preserves_saved_everywhere -q
```

- [x] **Step 2: Run to verify it fails**

Run: `uv run python -m pytest tests/ -q; uv run ruff check .`
Expected: FAIL — 1 failure plus 4 ruff errors.

- [x] **Step 3: Minimal implementation**

```python
if not submission.text.strip():
    return saved
```

Preserve on blank input; fix 4 ruff sites; keep `testpaths=["tests"]`; CI uses `uv sync --frozen`.

- [x] **Step 4: Run to verify it passes**

Run: `uv run python -m pytest tests/ -q && uv run ruff check .`
Expected: PASS — 77 passed, ruff clean.

- [x] **Step 5: Commit**

```bash
git add tests/test_bugfix_p0.py pyproject.toml .github/workflows/ci.yml
git commit -m "fix: zero baseline"
```

### Task 6: DeepEval golden gate plus eval status endpoint

**Files:** Modify `evals/test_deepeval_ci.py`, `pyproject.toml`, `services/rag_engine/app.py`, `.github/workflows/ci.yml`, `start.sh`

**Interfaces:** Consumes `evals/golden_dataset.json`; DeepEval `FaithfulnessMetric(threshold=0.90)`. Produces blocking `deepeval test run evals/`; `GET /v1/eval/status` returns `{"pass_rate": float, "passed": int, "total": int, "stubbed": bool}`; `./start.sh --eval` runs both gates.

- [x] **Step 1: Write the failing test**

```python
from deepeval import assert_test
from deepeval.metrics import FaithfulnessMetric
assert_test(case, [FaithfulnessMetric(threshold=0.90)])
```

- [x] **Step 2: Run to verify it fails**

Run: `uv run deepeval test run evals/`
Expected: FAIL — plain `pass_rate >= 0.90` asserts (`test_deepeval_ci.py:142`) with mocked judge (`:90-106`).

- [x] **Step 3: Minimal implementation**

```python
metric = FaithfulnessMetric(threshold=0.90)
assert_test(LLMTestCase(input=q, actual_output=a, retrieval_context=ctx), [metric])
```

Floor `deepeval>=4.0`; max one labeled stub; add `/v1/eval/status`; split CI; add `--eval`.

- [x] **Step 4: Run to verify it passes**

Run: `uv run python -m pytest tests/ -q && uv run deepeval test run evals/`
Expected: PASS — both gates green, `pass_rate >= 0.90`.

- [x] **Step 5: Commit**

```bash
git add evals/test_deepeval_ci.py pyproject.toml services/rag_engine/app.py .github/workflows/ci.yml start.sh
git commit -m "feat: eval gate plus status"
```

## Phase 3 — Modern upgrades

Verify: `uv lock --check && curl -sf http://localhost:3000/api/health && ls docs/quickstart.md docs/runbook.md`.

### Task 7: Langfuse v4 server plus SDK migration

**Files:** Modify `docker-compose.yml`, `services/rag_engine/observability/langfuse_client.py`, `pyproject.toml`

**Interfaces:** Consumes `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`. Produces `GET http://localhost:3000/api/health` 200 on server v4; zero legacy `update_current_trace|start_span|start_generation` calls.

- [ ] **Step 1: Write the failing check**

```bash
rg -n "update_current_trace|start_span|start_generation" packages services evals; test $? -ne 0
```

- [ ] **Step 2: Run to verify it fails**

Run: `rg -n "update_current_trace|start_span|start_generation" packages services evals | head -20`
Expected: FAIL — legacy calls present; compose pins `langfuse:2` against SDK 4.14.4.

- [ ] **Step 3: Minimal implementation**

```python
obs = client.start_observation(trace_id=tid, name="rag.query", input={"query": q})
obs.update(output={"answer": a})
```

Server v4 first (`legacy→dual→events_only`, ClickHouse ≥25.12); trace I/O → observation I/O; OTel lockstep.

- [ ] **Step 4: Run to verify it passes**

Run: `rg -n "update_current_trace|start_span|start_generation" packages services evals; echo "exit=$?"; curl -sf http://localhost:3000/api/health`
Expected: PASS — rg exits 1, health 200.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml services/rag_engine/observability/langfuse_client.py pyproject.toml
git commit -m "feat: langfuse v4"
```

### Task 8: Stepwise Qdrant/Neo4j plus Node 22 and LiteLLM re-pin

**Files:** Modify `docker-compose.yml`, `Dockerfile`, Qdrant call sites under `packages/` and `services/`

**Interfaces:** Consumes `QDRANT_API_KEY`, non-empty `NEO4J_PASSWORD`, `LITELLM_MASTER_KEY`. Produces `query_points`-only retrieval; `GET http://localhost:6333/healthz` 200; `npm --prefix web run build` green on Node 22.

- [ ] **Step 1: Write the failing check**

```bash
rg -n "\.search\(|\.recommend\(" packages services; test $? -ne 0
```

- [ ] **Step 2: Run to verify it fails**

Run: `rg -n "\.search\(|\.recommend\(" packages services | head`
Expected: FAIL — legacy calls present; Qdrant 1.11.3, unpinned `nodejs npm` (`Dockerfile:3-5`).

- [ ] **Step 3: Minimal implementation**

```python
points = client.query_points(collection_name=name, query=vector, limit=top_k).points
```

Server 1.11→1.15→1.17→1.19 with `QDRANT_API_KEY`; Neo4j 5.26.x + driver 6.x; Node 22; LiteLLM re-pin keeping `/health/readiness`.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run python -m pytest tests/ -q -k "retriev or qdrant or hybrid" && uv lock --check`
Expected: PASS — retrieval subset green, lockfile clean.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml Dockerfile packages services pyproject.toml uv.lock
git commit -m "feat: qdrant-neo4j-node-litellm pins"
```

### Task 9: Docs IA plus eval visibility

**Files:** Modify `README.md`; create `docs/quickstart.md`, `docs/runbook.md`

**Interfaces:** Consumes `GET /v1/eval/status` JSON. Produces architecture-only README plus links; quickstart covers boot/seed/first-query; runbook covers env matrix, health matrix, fallback, logs, upgrade order; Studio badge reads `/v1/eval/status`.

- [ ] **Step 1: Write the failing check**

```bash
ls docs/quickstart.md docs/runbook.md && rg -n "eval/status" web/src docs/runbook.md
```

- [ ] **Step 2: Run to verify it fails**

Run: `ls docs/quickstart.md docs/runbook.md; echo "exit=$?"`
Expected: FAIL — neither file exists; `README.md:86-126` marks compose optional with no fallback, seeding, or health contract.

- [ ] **Step 3: Minimal implementation**

```markdown
1. `cp .env.example .env` and fill the four secrets.
2. `./start.sh --dev`, wait for `/health/ready` 200.
3. `uv run python scripts/seed_demo.py --tenant demo`, then POST `/v1/query`.
```

Slim README to architecture plus links; runbook matrices and upgrade order; Studio badge → `/v1/eval/status`.

- [ ] **Step 4: Run to verify it passes**

Run: `ls docs/quickstart.md docs/runbook.md && uv run python -m pytest tests/ -q`
Expected: PASS — docs exist, suite green.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/quickstart.md docs/runbook.md web/src
git commit -m "docs: quickstart-runbook plus badge"
```

## Self-Review

- Spec coverage: §5.1–5.2 → Tasks 1–2; boot → 3; seed → 4; §5.4 → 5; eval → 6; §5.6–5.8 → 7–8; docs → 9. Non-goals honored (no new stores, Python jump, LangChain rewrite, second framework, K8s).
- Placeholder scan: no TBD/TODO/later; every step has exact commands, assertions, paths; no cross-task content refs.
- Env/endpoint consistency: four secrets plus `/health/ready`, `/healthz`, `/health/readiness`, `/api/health`, `/v1/eval/status` spelled identically in tasks and interfaces.
