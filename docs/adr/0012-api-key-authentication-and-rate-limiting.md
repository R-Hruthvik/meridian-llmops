# 0012. API Key Authentication and Tenant Quotas

**Status:** Accepted · **Date:** 2026-08-17

We chose header-based API key authentication (`X-API-Key`) for lightweight service-to-service access and rate limiting.

**Current state (verified 2026-10-13):** FastAPI maps configured API keys to a server-side tenant and `user`/`admin` role; the standalone gateway is not required for RAG API authentication. Per-key rate limits are in-process. See [ADR-0025](0025-api-key-role-and-tenant-auth.md).
