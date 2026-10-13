# 0024. FastAPI Factory and Lifespan-Owned Services

**Status:** Accepted · **Date:** 2026-10-13 · **Plan decision:** D11

## Decision

Provide `create_app(settings, overrides)` and initialize service resources in the FastAPI lifespan. Keep the module-level `app` as a compatibility alias for existing launchers; new integrations should build an app through the factory.

## Rationale

Per-app state and injected service overrides allow isolated tests and avoid creating database clients or loading models as an import side effect.

## Consequences and current state

The factory and lifespan are in `services/rag_engine/routers/api.py`; `services/rag_engine/app.py` re-exports the compatibility app. Some legacy route seams remain during migration.

