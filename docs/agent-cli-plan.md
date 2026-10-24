# Agent CLI Plan (Meridian)

## 1. Provider & Model Review

### Current state
- Providers (`services/gateway/providers.py`): openai, anthropic, openrouter, deepseek, groq, ollama, custom. LiteLLM proxy is a separate `litellm` target in the client but is not exposed in the settings UI provider list.
- Generic env vars (`PROVIDER`/`API_KEY`/`BASE_URL`/`MODEL`, plus `LLM_*` aliases) override saved runtime settings (`_resolve_active_llm_config_with_secrets`). `.env` currently sets `API_KEY`, `BASE_URL`, `MODEL` without `PROVIDER`, so the active provider resolves to `custom`.
- `BASE_URL=http://localhost:3010/v1` is a private endpoint. Calls fail unless `ALLOW_PRIVATE_PROVIDER_URLS=true` is set. `.env` does not set it.
- Model: `kilo-auto/free` via a local OpenAI-compatible endpoint (likely OmniRoute). No direct provider entry for it; treated as `custom`.

### Findings
1. **Missing opt-in for private endpoint.** `.env` uses localhost:3010 but `ALLOW_PRIVATE_PROVIDER_URLS` is unset → `ProviderConfigError: URL is not allowed`. Add `ALLOW_PRIVATE_PROVIDER_URLS=true` (dev only) or switch to a public HTTPS endpoint.
2. **No explicit `PROVIDER`.** Relying on the "generic active → custom" fallback works but is implicit. Set `PROVIDER=custom` (or `openai_compatible`) explicitly.
3. **UI/provider mismatch.** `litellm` is a supported client target but absent from `get_providers_status`/`get_llm_settings`. Either document it as proxy-only or add it to the UI list.
4. **Embedding/model dimension alignment.** `embedding_model=BAAI/bge-small-en-v1.5` (384-dim) matches `qdrant_vector_dim=384`. Keep in sync if either changes (index rebuild required).
5. **Reranker default `none`.** `reranker_model` configured but unused unless `RERANKER=cross_encoder`. Fine for dev; document expected eval gate before enabling.
6. **Secrets persistence.** Keys move from settings file to a separate secrets file with `0o600` perms; masked view returns only last-4 hints. Generic env vars are not persisted (by design). Good.
7. **SSRF hardening present.** `validate_provider_url` + pinned transport + DNS resolution pinning. Keep as-is; CLI must reuse the same client path, not bypass it.
8. **Pricing table sparse.** `config/pricing.json` only lists gpt-4o-mini/gpt-4o; cost estimates for other models will be missing. Non-blocking.

### Recommended `.env` additions (dev)
```
PROVIDER=custom
ALLOW_PRIVATE_PROVIDER_URLS=true
```

## 2. CLI Goal
Give the agent (and developers) a single, scriptable entry point to exercise the running Meridian app without curl/JSON hand-editing, with machine-readable output for agent consumption.

Non-goals: replacing `start.sh`, managing Docker, or duplicating ingestion logic.

## 3. Proposed CLI

Package: `meridian_cli` (new) registered in `pyproject.toml`:
```
[project.scripts]
meridian = "meridian_cli.main:app"
```
Dependencies: `typer>=0.12`, `rich>=13` (httpx already present).

### Commands
| Command | Purpose | Auth |
|---|---|---|
| `meridian health` | Liveness/readiness of backend | none |
| `meridian retrieve "query" [--top-k N] [--json]` | POST /v1/retrieve | user key |
| `meridian query "question" [--top-k N] [--stream] [--json]` | POST /v1/query (and /v1/query/stream) | user key |
| `meridian ingest PATH [--recursive]` | Run folder ingestion (delegates to `scripts/ingest_folder.py`) | none (local) |
| `meridian reindex` | Rebuild Qdrant collection | none (local) |
| `meridian settings show` | GET /v1/settings/llm | admin |
| `meridian settings test` | POST /v1/settings/llm/test | admin |
| `meridian settings set-provider --provider P --model M [--base-url U] [--api-key K]` | POST /v1/settings/llm | admin |
| `meridian models list --provider P [--base-url U] [--api-key K]` | POST /v1/settings/llm/test-and-fetch-models | admin |
| `meridian smoke` | health + retrieve + query on sample question; non-zero exit on failure | user |

### Global options
- `--base-url` (default `$MERIDIAN_BASE_URL` or `http://localhost:8000`)
- `--api-key` / `--admin-key` (from `$MERIDIAN_API_KEY` / `$MERIDIAN_ADMIN_API_KEY`)
- `--json` machine output; `--quiet` suppresses progress
- `--timeout` (default 60s)

### Output contract for agents
- Default: concise human summary + exit code.
- `--json`: print a single JSON object to stdout with `{"ok": bool, "data": ..., "error": ...}`. All diagnostics to stderr. Exit code 0/1/2.

## 4. File Layout
```
meridian_cli/
  __init__.py
  main.py          # Typer app + global options
  client.py        # httpx wrapper, auth headers, error mapping
  commands/
    health.py
    retrieve.py
    query.py
    ingest.py
    settings.py
    models.py
    smoke.py
  config.py        # env/flag resolution
tests/
  test_cli_client.py
  test_cli_commands.py   # MockTransport-based, no server
```

## 5. Implementation Phases

1. **Scaffold** (1 PR): package + entry point + `health` + `retrieve` + global config. Verify: `meridian health`, `meridian retrieve "..." --json`.
2. **Query + streaming**: add `query` with `--stream` and SSE parsing reuse from client.
3. **Settings/admin**: show/test/set-provider/models. Reuse masked view; never print keys.
4. **Ingest/reindex wrappers**: shell out to existing scripts with the project's Python; propagate exit codes.
5. **Smoke command**: composite check with clear pass/fail summary and exit codes.
6. **Docs + tests**: README section, `make cli-test` target, MockTransport unit tests.

## 6. Testing Strategy
- Unit: MockTransport, no network, no server, no Qdrant. Assert request shapes, headers, JSON parsing, exit codes via `typer.testing.CliRunner`.
- Integration (marker `integration`): real backend on localhost:8000; skipped in CI by default.
- Agent usage: prefer `--json` and check exit code; parse stdout only.

## 7. Risks / Decisions
- Keep CLI thin; do not reimplement provider logic. All LLM calls go through backend endpoints so SSRF and redaction stay in one place.
- Admin key handling: never echo keys; support masked hints only.
- Avoid storing secrets in CLI config files; rely on env.
- Version pin Typer to avoid breaking changes.

## 8. Open Questions
- Should `meridian serve` wrap `start.sh --backend-only`? Recommendation: no; keep server lifecycle separate to avoid process management complexity. Revisit if agents need one-command startup.
- Should the CLI be published as part of the package or dev-only? Recommendation: dev dependency + console script in main package (already installable via `uv sync`).
