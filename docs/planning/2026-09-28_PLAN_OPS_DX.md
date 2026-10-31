# Meridian LLMOps — OPS + EVALS + DX Improvement Plan

## 1. Current state

- **Compose boots insecure-by-default.** `docker-compose.yml:5` pins Qdrant `v1.11.3` with no API-key auth, `docker-compose.yml:27` allows `NEO4J_AUTH=neo4j/` empty, `docker-compose.yml:43-64` leaves `LITELLM_MASTER_KEY`/`POSTGRES_PASSWORD` empty, and `docker-compose.yml:75` pins `langfuse/langfuse:2` while the lockfile resolves SDK `4.14.4`.
- **Image and launcher ship test secrets to the browser.** `Dockerfile:20-21` bakes `API_KEY_SECRET`/`LITELLM_MASTER_KEY` into the image; `start.sh:72-74` re-exports the secret as `VITE_MERIDIAN_API_KEY`; `start.sh:44-55` continues silently when Docker fails into an undocumented fallback.
- **CI diverges from local runs.** `.github/workflows/ci.yml:37-38` hardcodes the test secret, `.github/workflows/ci.yml:58` runs `pytest tests/ evals/` explicitly while `pyproject.toml:52` sets `testpaths=["tests"]` (plain `pytest` skips evals), and CI uses `pip install -e ".[dev]"` while developers use `uv sync`.
- **Eval gate is narrow and partly stubbed.** `evals/golden_dataset.json:1-37` holds a handful of cases; `evals/test_deepeval_ci.py:90-106` mocks `CriticAgent.evaluate` when `APP_ENV=testing`; `evals/test_deepeval_ci.py:142` enforces `pass_rate >= 0.90` with plain asserts, not DeepEval 4.x metrics. Suite state: 76 pass, 1 fail (`test_blank_submission_preserves_saved_everywhere`), 4 ruff errors.
- **Docs describe architecture, not operations.** `README.md:86-126` (181 lines) marks `docker-compose up -d` optional and never defines fallback, seeding, or health; `docs/` has `adr/`, `agents/`, `planning/` but no quickstart/runbook; `.env.example:1-2` lists only `OMNIROUTE_API_KEY` while `tests/conftest.py:8-11` needs four more secrets.

## 2. Confusion audit

Five stories collide. Cold start is ambiguous: README says infra is optional, `start.sh` tolerates Docker failure, and the SQLite default (`packages/core/config.py:51`) serves empty-but-healthy with no log saying which backend won. Seeding contradicts itself: production boots empty by design (issue #23; self-seeding fixture in `evals/test_deepeval_ci.py:59-79`), yet no doc tells operators how to get demo data, so blank UI reads as a bug. Health is uncheckable: Qdrant/Neo4j/LiteLLM have healthchecks but `langfuse` has none and nothing wires app readiness to `depends_on`, so the launcher prints green URLs before dependencies answer. The eval gate misleads: CI claims DeepEval but runs mocked-judge asserts invisible from the UI, so green builds do not mean grounded answers improved. Secrets teach bad habits: committed test keys in `Dockerfile`, `start.sh`, `ci.yml` plus a browser-exposed `VITE_` copy normalize pasting credentials into production.

## 3. Simplified restructure

**One-command boot, failing closed.** `./start.sh` stays the only entrypoint (`--dev/--prod/--backend-only/--gateway-only/--eval`): validate secrets up front, exit non-zero when missing (dev may mint an ephemeral one once; prod never defaults). Launch via `docker compose up --wait`, then poll app `/health/ready` before printing URLs. Docker failure is a loud error; `--no-infra` opts into a bannered SQLite/in-memory fallback.

**Seeded samples opt-in.** Keep clean-boot default. Add `scripts/seed_demo.py --tenant demo` (canonical fixture docs plus adversarial examples). Dev boot offers seeding once; CI seeds only inside the eval fixture with cleanup.

**Single eval gate.** `pytest tests/ -q` (fast unit gate) plus `deepeval test run evals/` (golden set, `assert_test`, Faithfulness >= 0.90) both block merges; `./start.sh --eval` runs both locally. Expose last result at `GET /v1/eval/status` with a Studio badge so eval state is visible outside CI logs.

**Docs IA: readme / quickstart / runbook.** Shrink `README.md` to architecture plus links; add `docs/quickstart.md` (boot, seed, first query) and `docs/runbook.md` (env matrix, health matrix, fallback semantics, logs, upgrade order). Fold `docs/agents/` overlap into a runbook appendix; convert `2026-09-28_TECH_TRENDS_CATCHUP.md` batches to issues; delete superseded planning docs once migrated.

**Non-goals:** no new stores, no Python 3.13/3.14 jump, no LangChain v1 rewrite, no second eval framework, no Kubernetes manifests.

## 4. Modern-tool upgrades

| Tool | Current | 2026 latest (fetched) | Adopt / skip + why |
|---|---|---|---|
| Langfuse server | compose `:2` | v4 GA; Cloud v4-only 2026-11-16 | **Adopt first** — SDK v4 + server v2 unsupported; migrate `legacy→dual→events_only`, ClickHouse ≥25.12 ([guide](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4), [FAQ](https://langfuse.com/faq/all/upgrade-to-langfuse-v4)) |
| Langfuse SDK | floor `>=2.20`, lock 4.14.4 | Python ≥4.7.0 for realtime v4 | **Adopt** — `start_span/generation→start_observation`, trace I/O to observation I/O ([v4 docs](https://langfuse.com/docs/v4)) |
| DeepEval | floor `>=0.21` | 4.2.4 ([PyPI](https://pypi.org/project/deepeval/4.2.4/), [releases](https://github.com/confident-ai/deepeval/releases/tag/python-v4.1.9)) | **Adopt** — floor `>=4.0`, gate via `assert_test` + `deepeval test run` ([CI guide](https://deepeval.com/docs/evaluation-unit-testing-in-ci-cd)) |
| OTel API/SDK | floor `>=1.23` | 1.43.0 ([releases](https://github.com/open-telemetry/opentelemetry-python/releases/tag/v1.43.0)) | **Adopt** — lockstep minor bump; needed for v4 OTLP ingest |
| Qdrant | server 1.11.3 / client floor 1.8 | server 1.19.x / client 1.19.1 | **Adopt stepwise** — 1.11→1.15→1.17→1.19, `search→query_points`, add `QDRANT_API_KEY` + `/healthz` check |
| Neo4j | server 5.18-community | 5.26.x line | **Adopt** — pair with driver 6.x; require non-empty password |
| LiteLLM | `main-v1.35.8` | rolling `main-` tags | **Adopt** — re-pin quarterly, keep `/health/readiness` probe |
| Node for Vite 8 | apt `nodejs` unpinned | Node ≥20.19/22.12 | **Adopt** — pin Node 22; apt default risks broken `web/dist` build |
| Python base | `3.11-slim` | 3.13/3.14 current | **Skip now** — 3.11 supported; defer past Langfuse/Qdrant |
| Install path | `uv` local vs `pip` CI | `uv.lock` source of truth | **Adopt** — CI on `uv sync --frozen` |

## 5. Sequenced improvement plan

1. **Close secret defaults.** Touch `start.sh`, `Dockerfile`, `docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml`. Fail closed on missing secrets; drop `VITE_` default export; expand `.env.example` to full matrix. Verify: `API_KEY_SECRET= LITELLM_MASTER_KEY= ./start.sh --backend-only` exits non-zero; `uv run ruff check .`.
2. **Health-gate the stack.** Touch `docker-compose.yml`, `start.sh`. Add Langfuse healthcheck, `depends_on: service_healthy`, Qdrant API-key env; launcher uses `docker compose up --wait` plus readiness poll. Verify: `docker compose up --wait && curl -sf http://localhost:6333/healthz && curl -sf http://localhost:4000/health/readiness`.
3. **Fix blank-start story.** Touch app startup log, new `scripts/seed_demo.py`, new `docs/quickstart.md`. Boot logs `storage=`/`graph=` backend lines; seed script is the only demo writer. Verify: `uv run python scripts/seed_demo.py --tenant demo && uv run python -m pytest tests/ -q`.
4. **Zero the baseline.** Touch failing test owner file, flagged ruff sites. Fix `test_blank_submission_preserves_saved_everywhere` and 4 ruff errors before tightening gates. Verify: `uv run python -m pytest tests/ -q` and `uv run ruff check .` green.
5. **Promote the real eval gate.** Touch `evals/test_deepeval_ci.py`, `pyproject.toml`, `.github/workflows/ci.yml`. Floor `deepeval>=4.0`; split CI into `pytest tests/` and `deepeval test run evals/` jobs on uv; metric-backed `assert_test`, one labeled stubbed case max. Verify: `uv run python -m pytest tests/ -q && uv run deepeval test run evals/`.
6. **Upgrade Langfuse.** Touch `docker-compose.yml`, `packages/`, `services/`, `evals/`. Server v4 in staging first, then SDK observation migration. Verify: `rg -n "update_current_trace|start_span|start_generation" packages services evals` empty; `curl -sf http://localhost:3000/api/health`.
7. **Stepwise Qdrant + Neo4j.** Touch `docker-compose.yml`, retrieval call sites. Verify: `rg -n "\.search\(|\.recommend\(" packages services` empty; `uv run python -m pytest tests/ -q -k "retriev or qdrant or hybrid"`.
8. **Pin Node 22, re-pin LiteLLM.** Touch `Dockerfile`, `docker-compose.yml`. Verify: `docker build .` and `npm --prefix web run build` green; `uv lock --check`.
9. **Docs IA + eval visibility.** Touch `README.md`, new `docs/quickstart.md`/`docs/runbook.md`, `GET /v1/eval/status` owner, Studio badge. Verify: `ls docs/quickstart.md docs/runbook.md` and `uv run python -m pytest tests/ evals/ -q`.

## Cross-part note

Boot fails closed on secrets and waits on healthy infra before any part serves. Health names the active backend so RAG, gateway, and UI agree on fallback. The pytest plus golden-set eval gate blocks every part; mocked judges stay labeled. Seeding is opt-in — nothing auto-writes demo data. Langfuse v4 observations-first moves across all parts together.
