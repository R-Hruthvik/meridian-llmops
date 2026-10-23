# Contributing

Contributions welcome. This is a Python (FastAPI) backend plus a React/Vite frontend.

## Dev setup

Requirements: Python 3.11+, `uv`, Node.js/npm, Docker.

```sh
make setup          # installs Python and frontend deps
make up             # starts Qdrant
cp .env.example .env  # if present; otherwise create .env per README
```

Configure `.env` per the README five-minute local start. Never commit `.env`.

## Running

```sh
./start.sh --backend-only   # API only
./start.sh                  # API + web
```

## Tests

```sh
make test              # pytest tests/ evals/
make retrieval-check   # isolated retrieval smoke check
cd web && npm run test:run
cd web && npm run lint
```

Run the focused test for the area you changed rather than the full suite when iterating.

## Pull requests

1. Branch from `main` (e.g. `fix/...`, `feat/...`).
2. Keep changes scoped to one concern; match existing style.
3. Ensure tests and lint pass.
4. Open PR against `main` with a clear description; reference the issue number.
5. At least one review before merge.

## Code standards

- Strict typing; avoid `any`/loose objects.
- Functional, composable patterns preferred.
- No dead code or TODO placeholders in production files.
