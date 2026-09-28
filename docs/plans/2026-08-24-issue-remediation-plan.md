# Meridian LLMOps — Issue Remediation Plan (2026-08-24)

## Context

Session workflow: read issues → read project → myo-assisted research → plan → user approval → build.

**Audit result:** Open issues #23–#28 (clean-start, readiness banner, Qdrant persistence,
Neo4j persistence, non-destructive settings merge, documents catalog API) are already
implemented in the **uncommitted working tree** (~800 insertions). Full suite: 76 passed / 1 failed.
Ruff: 52 errors (38 auto-fixable).

## Outstanding work

### Phase 1 — Bug fix: gateway healthcheck (Issue #33)
docker-compose.yml L51 probes the LiteLLM gateway with wget; the image ships no wget →
container permanently unhealthy (confirmed live: meridian-litellm-gateway Up 11 hours (unhealthy)).
- Replace probe with a python3 stdlib urllib CMD-SHELL probe (no new packages installed):
  test: ["CMD-SHELL", "python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:4000/health/readiness',timeout=5).status==200 else 1)"" || exit 1"]
- Research refs (myo smart-search): docs.litellm.ai/docs/proxy/health, BerriAI Dockerfile.health_check,
  GitHub issue BerriAI/litellm#5161.
- Acceptance: docker compose ps shows healthy ≤60s after restart; probe exits non-zero when process down.

### Phase 2 — Security: remove hardcoded API key from tracked config
Uncommitted diff of tracked services/gateway/litellm_config.yaml contains a literal omniroute key
(sk-461f…47b6) three times. Prior commit 0915bb9 rotated a leaked Groq key — same leak class.
- Replace with os.environ/OMNIROUTE_API_KEY; wire value through docker-compose environment/env_file
  (gitignored .env). Add placeholder to .env.example.
- **User action required:** revoke/rotate the exposed key at the omniroute provider (agent cannot).
- Acceptance: git grep sk-461f returns nothing; gateway still routes post-change.

### Phase 3 — Red CI gate: DeepEval golden dataset (regression from #23)
Clean-start change emptied the KB at boot, but evals/test_deepeval_ci.py assumes golden-dataset docs
exist → retriever returns nothing → refusals → verified=False for gold-001.
- Seed fixtures inside the test: session-scoped fixture ingests golden-dataset source docs via the
  app's own ingestion path before evaluation (idempotent; purge first).
- Production boot stays clean (#23 semantics preserved); only the eval self-seeds.
- Acceptance: APP_ENV=testing MERIDIAN_API_KEY=… pytest tests/ evals/ → 77 passed, 0 failed.

### Phase 4 — Lint debt: 52 ruff errors (CI-blocking hygiene)
Breakdown: I001×12, UP006×11, UP035×6, UP045×5, F401×5, UP017×3, BLE001×3, RUF059×2, B008×2,
SIM102×1, S110×1, RUF100×1, PLR1730×1. Hotspots: packages/verification/tiered_verifier.py (14),
packages/core/schemas.py (10), routers/review.py (6).
- ruff check --fix for the 38 auto-fixables; hand-fix remainder (log in S110, narrow or
  noqa-with-reason BLE001, evaluate B008 FastAPI Depends pattern vs per-file ignore).
- Acceptance: ruff check . → 0 errors; no behavior changes (tests still green).

## Execution order & commits
Phases 1→4 as separate conventional commits (fix:, fix(security):, fix(evals):, chore(lint):),
each verified independently (tests + targeted checks) before the next.

## Explicitly out of scope
- Wayfinder perf map items #16/#19/#20/#22 (blocked chain: baseline harness first).
- Rotating the omniroute key at the provider (user-side action).
- Any refactor beyond the four phases (surgical-change policy).