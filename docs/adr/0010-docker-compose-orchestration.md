# 0010. Unified Docker Compose Environment for Local Dev and CI

**Status:** Accepted (drifted) · **Date:** 2026-08-17

We chose Docker Compose as the standard orchestration definition for local development and CI test runners. A single `docker-compose.yml` launches and health-checks Qdrant, Neo4j, LiteLLM Proxy, Langfuse, and the FastAPI application services.

## Current Status

**Current state (verified 2026-10-13):** `docker compose up -d` starts Qdrant only. Neo4j, LiteLLM, Langfuse, and the app are under optional profiles. The app profile builds and runs the FastAPI service; the web UI is built/served separately by `start.sh`. Compose configuration is in `docker-compose.yml`.
