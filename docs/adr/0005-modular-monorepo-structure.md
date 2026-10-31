# 0005. Modular Monorepo Architecture

**Status:** Accepted (drifted) · **Date:** 2026-08-17

We structured the codebase as a modular monorepo containing distinct services (`services/gateway`, `services/rag_engine`, `services/ingestion`, `services/critic_eval`), shared core schemas (`packages/core`), and CI/CD evaluation testbeds (`evals/`). This enables independent testing and deployment while maintaining single-source-of-truth domain models.

## Current Status

**Current state (verified 2026-10-06):** 3 of the 4 named services exist (`gateway`, `ingestion`, `rag_engine`). `services/critic_eval` was never built - the critic lives at `services/rag_engine/agent/critic.py`.
