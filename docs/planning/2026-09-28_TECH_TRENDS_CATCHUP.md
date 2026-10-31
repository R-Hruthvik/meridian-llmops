# TECH TRENDS CATCH-UP — Meridian LLMOps Stack (2026-09-28)

Scope: `pyproject.toml` floors vs 2026 latest; `uv.lock` spot-check; `docker-compose.yml`, `web/package.json`, `Dockerfile`, CI. No dependency edits made.

Key context: floors are stale minima, but **`uv.lock` is fresh (July 2026 uploads)** — it already resolves to fastapi 0.141.1, langgraph 1.2.11, langchain-core 1.5.6, langfuse 4.14.4, neo4j 6.2.0, deepeval 4.1.8, httpx 0.28.1. So the app code runs modern versions; the risk sits in **floors, compose pins, and Docker/CI drift**.

## 1. Currency table

| Dep | Pinned floor | 2026 latest (per search) | Verdict | Risk |
|---|---|---|---|---|
| fastapi | >=0.110 | 0.141.x | behind (floor) / lock current | `@app.on_event` deprecated → must use `lifespan=`; dead if still used |
| langgraph | >=0.0.30 | 1.2.x | behind (floor) / lock current | `create_react_agent` deprecated → `langchain.create_agent`; Py3.9 dropped (we're 3.11, fine) |
| langchain-core | >=0.1.30 | 1.5.x | behind (floor) / lock current | 1.x middleware/agent API; harmless if lock respected |
| pydantic | >=2.6 | 2.13.5 (2.14 beta) | current (v2 line) | V1 only gets sec-fixes until V3; stay on v2, no action |
| langfuse (sdk) | >=2.20 | v4 (lock: 4.14.4) | floor EOL-track | **SDK v4 breaking**: `update_current_trace` split, `start_span/generation` → `start_observation`, metadata now `dict[str,str]` ≤200ch |
| langfuse (server) | compose `:2` | v4 GA; Cloud v4-only **2026-11-16** | **EOL-imminent** | SDK v4 + server v2 is an unsupported combo; top upgrade priority |
| qdrant server | compose v1.11.3 | 1.19.x | behind | `search/recommend` removed → `query_points`; RocksDB dropped in 1.17 → stepwise upgrade only |
| qdrant-client | >=1.8 | 1.19.1 | behind (floor) | same `query_points` migration; check client calls |
| neo4j server | compose 5.18-community | 5.x/2026.x line moved on | behind | driver in lock is 6.2.0; bump server image in step with driver |
| uvicorn | >=0.28 | ~0.34+ | behind (floor) | minor; safe bump |
| httpx | >=0.27 | 0.28.x | current | none |
| sqlalchemy | >=2.0.28 | 2.0.x line | current | none |
| OTel api/sdk | >=1.23 | 1.3x line | slightly behind | safe minor bump; keep api/sdk in lockstep |
| deepeval | >=0.21 (dev) | 4.x (lock: 4.1.8) | floor EOL | eval-gate API drift; pin floor near lock |
| React / Vite / plugin-react | 19.2 / 8.2 / 6.0 | current (Vite 8 = Rolldown) | current | Vite 8 CJS-interop break: default-imports of CJS libs can resolve to `{default: …}`; audit icon/UI lib imports |
| python base | Dockerfile `3.11-slim` | 3.13/3.14 current | behind, low urgency | 3.11 supported; defer base jump until after Langfuse/Qdrant |
| litellm gateway | main-v1.35.8 | rolling `main-` tags | stale pin | gateway moves fast; re-pin quarterly, verify `/health/readiness` |
| node (Dockerfile apt) | distro apt node | Vite 8 needs Node ≥20.19/22.12 | **build risk** | apt node may be <20.19 → frontend build breaks; pin Node major explicitly |

## 2. Trend notes — agentic RAG 2026 (adopt vs skip)

- **Adopt — attribution/provenance:** 2026 RAG pattern is cite-every-claim (chunk IDs + scores in API responses). Cheap, matches our gateway-governance story; add to rag_engine response schema.
- **Adopt — eval gates with DeepEval (already in CI):** lock is 4.x but floor says 0.21 — raise the floor and keep the `pytest tests/ evals/` golden-dataset gate blocking. Trend is LLM-as-judge on observations, which pairs with Langfuse v4's observations-first model.
- **Adopt — hybrid retrieval + reranker (bge-reranker-large class):** BM25 (rank-bm25 already a dep) + Qdrant `query_points` fusion, then cross-encoder rerank top-k. Fits current two-store (Qdrant+Neo4j) design; implement as a rerank stage, not a new store.
- **Adopt — gateway governance:** LiteLLM spend/key guardrails + audit logging (Qdrant 1.18 adds audit-log API + tracing IDs) — keep gateway as the policy choke point.
- **Skip — chasing LangChain v1 agent-middleware rewrites:** our StateGraph primitives are unchanged in 1.x; adopt `create_agent` only for new agents.
- **Skip — Python 3.14 / TS-next / Qdrant 2.x rumors:** no signal of a Qdrant 2.0; don't pre-migrate.

## 3. Restructured proposal

- **Batch A — safe floor bumps (no code change):** uvicorn, httpx, OTel api+sdk (lockstep), sqlalchemy, pydantic floor → >=2.13, rank-bm25/tenacity/numpy as locked. Regenerate lock, run linters.
- **Batch B — breaking majors with migration notes:** (1) Langfuse server `:2` → v4 + SDK-v4 call-site migration (`start_observation`, `propagate_attributes`, metadata coercion); do server first in staging. (2) Qdrant server stepwise 1.11→1.15→1.17→1.19 (RocksDB/gridstore constraint) + client `search`→`query_points`. (3) langgraph floor → >=1.0 with `create_react_agent`→`create_agent` audit. (4) Neo4j server image bump paired with driver 6.x.
- **Batch C — build/CI hygiene:** pin Node 22 in Dockerfile (multi-stage or nodesource), re-pin LiteLLM tag, raise deepeval floor to >=4.0, audit Vite-8 CJS default imports in `web/`.
- **NOT chasing:** Python base jump, new vector stores, agent-framework rewrites, TS major churn.

## 4. Top 5 stack moves (each with verification)

1. **Langfuse server v2 → v4 (staging first)** — `docker compose up -d langfuse-db langfuse && python3 -c "import urllib.request; print(urllib.request.urlopen('http://localhost:3000/api/health', timeout=5).status)"`
2. **Migrate SDK-v4 call sites** — `rg -n "update_current_trace|start_span|start_generation|item\.run\(" packages services evals` → zero hits, then `pytest tests/ evals/ -v`
3. **Qdrant stepwise upgrade + `query_points`** — `rg -n "\.search\(|\.recommend\(|on_disk_payload" packages services` → zero hits, then `pytest tests/ -v -k "qdrant or retriev or hybrid"`
4. **Pin Node 22 in Dockerfile; rebuild frontend** — `npm --prefix web run build` (or `docker build .`) green with zero `Element type is invalid` errors
5. **Raise stale floors (uvicorn/OTel/deepeval/pydantic/langgraph) + relock** — `uv lock --check && uv run ruff check . && mypy packages services evals --ignore-missing-imports`

## Integration note (parent)

- Report written; no repo files touched except this one.
- Loudest alarm: Langfuse server `:2` vs SDK v4 + Cloud v4-only cutover 2026-11-16.
- Second: Qdrant 1.11 → 1.19 needs stepwise path (gridstore), not a direct jump.
- Lock is fresh; floors lie — treat Batch A as paperwork, Batches B/C as real work.
- Frontend is current but Dockerfile's apt-Node may not satisfy Vite 8; verify first.
- Suggested owner order: Langfuse → Qdrant → Node-pinning → floor bumps → reranker stage.
