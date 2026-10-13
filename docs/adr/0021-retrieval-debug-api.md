# 0021. Retrieval-Only Debug API

**Status:** Accepted · **Date:** 2026-10-13 · **Plan decision:** D8

## Decision

Expose `POST /v1/retrieve` and a UI retrieval diagnostics surface so operators can inspect ranked chunks and retrieval timings independently of answer generation.

## Rationale

Separating retrieval from generation makes it possible to determine whether a wrong or missing answer originates in indexing/retrieval or a later stage.

## Consequences and current state

The authenticated route returns chunk text, score/rank details, and `timings_ms`; the web UI includes retrieval diagnostics. The isolated CLI smoke check in `scripts/retrieval_check.py` builds its own temporary in-memory index.

