# 0025. Server-Mapped API Keys, Roles, and Tenants

**Status:** Accepted · **Date:** 2026-10-13 · **Plan decision:** D12

## Decision

Map each API key server-side to a tenant and a `user` or `admin` role. Derive request tenancy from the authenticated identity; ignore a caller-supplied tenant header for authorization. Require admin role for settings and other administrative operations.

## Rationale

A tenant header selected by the caller is not an identity boundary. Server-side key mapping keeps tenant and privilege selection under operator control.

## Consequences and current state

`API_KEYS` accepts a JSON mapping of keys to tenant/role records. Authentication and role dependencies are implemented in `services/gateway/auth.py` and `services/rag_engine/deps.py`. Rate limits are per-key and in-process.

